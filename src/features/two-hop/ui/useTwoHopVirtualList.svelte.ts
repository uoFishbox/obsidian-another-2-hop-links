import { onDestroy, untrack } from "svelte";
import type { Pos, TFile } from "obsidian";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import {
	createTwoHopRowModel,
	type TwoHopRowModel,
} from "features/two-hop/ui/twoHopRowModel";
import {
	buildMountedTwoHopRows,
	type MountedTwoHopBuild,
	type MountedTwoHopCell,
	type MountedTwoHopRow,
} from "features/two-hop/ui/twoHopMountedRows";
import { createTwoHopCardHydrator } from "features/two-hop/ui/twoHopCardHydrator";
import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";
import { DISABLED_PREVIEW_SURFACE } from "features/card-preview/runtime/previewRuntime";
import type {
	VirtualPreviewBinding,
	VirtualPreviewSurface,
} from "features/card-preview/scheduling/virtualPreviewSurface";
import { createReplaceableVirtualPreviewSurface } from "features/card-preview/scheduling/replaceableVirtualPreviewSurface";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { resolveCachedCardGridLayoutBase } from "ui/virtualization/dom/virtualListCardLayout";
import { CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES } from "ui/virtualization/cardVirtualListPolicy";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { useVirtualList } from "ui/virtualization/svelte/useVirtualList.svelte";
import { createVirtualListMeasurementState } from "ui/virtualization/dom/virtualListMeasurementState";
import {
	createVirtualMeasurementController,
	type VirtualMeasurement,
	type VirtualMeasurementApplicationResult,
} from "ui/virtualization/dom/virtualMeasurementController";
import { createVirtualScrollWindowRangeResolver } from "ui/virtualization/core/scrollWindowMeasurement";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
} from "ui/virtualization/core/scrollWindowGate";
import { createVirtualScrollWindowMeasurementController } from "ui/virtualization/svelte/virtualScrollWindowMeasurementController";
import type { VirtualVisibilityPolicy } from "ui/virtualization/core/virtualListEngine";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualRanges } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { ProgrammaticScrollSnapshot } from "ui/virtualization/dom/flushVirtualScrollMeasurement";
import { flushVirtualScrollMeasurement as flushCachedVirtualScrollMeasurement } from "ui/virtualization/dom/flushVirtualScrollMeasurement";

/** Dependencies required to enable previews on the two-hop virtual surface. */
export interface TwoHopPreviewDependencies {
	readonly previewRuntime: PreviewRuntime;
	readonly resolveSearchMatchPosition: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
}

export interface TwoHopVirtualListProps {
	readonly documentIdentity: string;
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly loadMoreSection?: (sectionId: string) => void;
	readonly previewActive?: boolean;
	readonly offscreenBootstrapPreviewRows?: number;
	readonly cardModelRevision: unknown;
	readonly resolveItemCardModel?: (
		item: TwoHopItemModel,
		presentation: TwoHopCardPresentationState,
		revision: unknown,
	) => CardRenderModel;
}

interface LayoutAnchor {
	readonly logicalKey: string;
	readonly rowTop: number;
	readonly scrollTop: number;
	readonly scrollRoot: HTMLElement | null;
}

const EMPTY_RANGE: Readonly<RowRange> = Object.freeze({ start: 0, end: 0 });
const EMPTY_MOUNTED_ROWS: readonly MountedTwoHopRow[] = [];
const RANGE_EFFECT_TASK_KEY = "two-hop-virtual-range-effects";

/** Connects two-hop geometry and hydration to the shared bounded virtual-list runtime. */
export function useTwoHopVirtualList(
	props: TwoHopVirtualListProps,
	frameCoordinator: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	let layout = $state.raw<ViewPlanLayoutMetrics>(DEFAULT_VIEW_PLAN_LAYOUT);
	let rowModel = $state.raw<TwoHopRowModel>(
		createTwoHopRowModel({
			documentIdentity: props.documentIdentity,
			sections: props.sections,
			layout: DEFAULT_VIEW_PLAN_LAYOUT,
		}),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let interactionShadowRoot = $state<ShadowRoot | null>(null);
	let measurement = $state(createVirtualListMeasurementState());
	let currentPreviewDependencies = props.previewDependencies;
	let lastDocumentIdentity = props.documentIdentity;
	let lastSections = props.sections;
	let lastCardModelRevision = props.cardModelRevision;
	let widthWasZero = false;
	let disposed = false;

	const rowSlotAllocator = createResidentRowSlotAllocator();
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const createPreviewSurface = (
		dependencies: TwoHopPreviewDependencies | undefined,
	): VirtualPreviewSurface =>
		dependencies
			? dependencies.previewRuntime.createSurface({
					frameCoordinator,
					resolveSearchMatchPosition: dependencies.resolveSearchMatchPosition,
				})
			: DISABLED_PREVIEW_SURFACE;
	const previewSurface = createReplaceableVirtualPreviewSurface(
		createPreviewSurface(currentPreviewDependencies),
	);

	function isPreviewSurfaceActive(): boolean {
		return (
			currentPreviewDependencies !== undefined && props.previewActive !== false
		);
	}

	function resolveVisibilityPolicy(model: TwoHopRowModel): VirtualVisibilityPolicy {
		const rowStride = model.layout.rowStride;
		return {
			bootstrapRows: Math.max(
				3,
				Math.max(0, Math.floor(props.offscreenBootstrapPreviewRows ?? 0)),
			),
			mountedOverscanPx: rowStride * 3,
			previewOverscanPx: rowStride,
		};
	}

	const virtualList = useVirtualList<
		ReturnType<TwoHopRowModel["getRow"]> extends infer TRow
			? TRow extends { getCell(columnIndex: number): infer TCell }
				? Exclude<TCell, null>
				: never
			: never,
		TwoHopRowModel,
		MountedTwoHopCell,
		MountedTwoHopBuild
	>({
		buildMountedCells: ({
			rowModel: nextRowModel,
			rowRange,
			previousBuild,
			previousCellsByKey,
		}) =>
			buildMountedTwoHopRows({
				rowModel: nextRowModel,
				rowRange,
				previousBuild,
				previousCellsByKey,
				rowSlotAllocator,
			}),
		mountedRowsReconciler: rowSlotAllocator,
		onStableVisibleRange: () => {
			measurement.hasStableVisibleRange = true;
		},
		onSnapshotUpdated: () => scheduleRangeEffects(),
		trackMountedCellsForChange: false,
	});

	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator,
		getRowModel: () => untrack(() => rowModel),
		getRevision: () => untrack(() => props.cardModelRevision),
		getResolver: () => untrack(() => props.resolveItemCardModel),
		isPreviewActive: isPreviewSurfaceActive,
		onPreviewModelsChanged: publishPreviewSnapshot,
	});

	function getMountedRows(): readonly MountedTwoHopRow[] {
		return (
			virtualList.getReconciliationState().mountedBuild?.rowsBySlot ??
			EMPTY_MOUNTED_ROWS
		);
	}

	function collectPreviewBindings(): VirtualPreviewBinding[] {
		if (!isPreviewSurfaceActive()) return [];
		const bindings: VirtualPreviewBinding[] = [];
		for (const row of getMountedRows()) {
			for (const mountedCell of row.cells) {
				if (mountedCell.cell.kind !== "item") continue;
				const request = cardHydrator.getModel(
					mountedCell.cell.logicalKey,
				)?.previewRequest;
				if (!request) continue;
				bindings.push({
					slotId: String(mountedCell.renderSlotKey),
					rowIndex: mountedCell.rowIndex,
					ownerKey: mountedCell.cell.logicalKey,
					request,
				});
			}
		}
		return bindings;
	}

	function publishPreviewSnapshot(): void {
		if (disposed) return;
		const snapshot = virtualList.getSnapshot();
		previewSurface.commit({
			active: isPreviewSurfaceActive(),
			activeRange: snapshot?.ranges.previewVisible ?? EMPTY_RANGE,
			bindings: collectPreviewBindings(),
		});
	}

	function applyRangeEffects(): void {
		if (disposed) return;
		const snapshot = virtualList.getSnapshot();
		const foreground = snapshot?.ranges.previewVisible ?? EMPTY_RANGE;
		cardHydrator.setDemand({
			foreground,
			background: isPreviewSurfaceActive()
				? (snapshot?.ranges.mounted ?? EMPTY_RANGE)
				: EMPTY_RANGE,
		});
		publishPreviewSnapshot();
	}

	function scheduleRangeEffects(): void {
		frameCoordinator.schedule(
			"post-paint",
			RANGE_EFFECT_TASK_KEY,
			applyRangeEffects,
		);
	}

	const rangeResolver = createVirtualScrollWindowRangeResolver<
		TwoHopRowModel,
		TwoHopRowModel
	>({
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy,
		resolveStableMountedScrollTopBand: true,
	});

	function shouldUseOffscreenBootstrap(
		nextMeasurement: VirtualMeasurement,
		model: TwoHopRowModel,
	): boolean {
		return (
			model.rowCount > 0 &&
			nextMeasurement.viewportHeight > 0 &&
			nextMeasurement.scrollTop - nextMeasurement.sectionTop <=
				-nextMeasurement.viewportHeight &&
			(props.offscreenBootstrapPreviewRows ?? 0) > 0
		);
	}

	function resolveOffscreenBootstrapRange(model: TwoHopRowModel): RowRange {
		return {
			start: 0,
			end: Math.min(
				model.rowCount,
				Math.max(0, Math.floor(props.offscreenBootstrapPreviewRows ?? 0)),
			),
		};
	}

	function resolveMountedMeasurement(
		nextMeasurement: VirtualMeasurement,
		model: TwoHopRowModel,
	): MountedScrollWindowMeasurement {
		const resolved = rangeResolver.resolveMountedScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			model,
		);
		if (!shouldUseOffscreenBootstrap(nextMeasurement, model)) return resolved;
		return { ...resolved, mounted: resolveOffscreenBootstrapRange(model) };
	}

	function resolveRangedMeasurement(
		nextMeasurement: VirtualMeasurement,
		model: TwoHopRowModel,
		precomputedMountedRange?: RowRange,
	): RangedScrollWindowMeasurement {
		const resolved = rangeResolver.resolveScrollWindowMeasurement(
			nextMeasurement.scrollTop,
			nextMeasurement.viewportHeight,
			nextMeasurement.sectionTop,
			model,
			precomputedMountedRange,
		);
		if (!shouldUseOffscreenBootstrap(nextMeasurement, model)) return resolved;
		const bootstrap = resolveOffscreenBootstrapRange(model);
		return {
			...resolved,
			ranges: {
				mounted: bootstrap,
				previewVisible: { ...bootstrap },
			},
		};
	}

	function applyVirtualMeasurement(
		nextMeasurement: VirtualMeasurement,
		model: TwoHopRowModel,
		precomputedRanges?: VirtualRanges,
	) {
		return virtualList.applyMeasurement({
			rowModel: model,
			scrollTop: nextMeasurement.scrollTop,
			viewportHeight: nextMeasurement.viewportHeight,
			sectionTop: nextMeasurement.sectionTop,
			isStableMeasurement: nextMeasurement.isStableMeasurement,
			isScrollActive: nextMeasurement.isScrollActive,
			hasStableVisibleRange: measurement.hasStableVisibleRange,
			precomputedRanges,
			visibilityPolicy: resolveVisibilityPolicy(model),
		});
	}

	const scrollWindowController =
		createVirtualScrollWindowMeasurementController<TwoHopRowModel>({
			resolveMountedScrollWindowMeasurement: resolveMountedMeasurement,
			resolveScrollWindowMeasurement: resolveRangedMeasurement,
			applyRangeMeasurement: (nextMeasurement, model, precomputedRanges) =>
				applyVirtualMeasurement(nextMeasurement, model, precomputedRanges),
			onStableMeasurement: () => {},
		});

	function captureLayoutAnchor(): LayoutAnchor | null {
		if (!rootEl || measurement.viewportHeight <= 0) return null;
		const scrollRoot = measurement.scrollContainerEl;
		const ownerWindow = getOptionalOwnerWindow(rootEl);
		if (!ownerWindow) return null;
		const scrollTop = scrollRoot?.scrollTop ?? ownerWindow.scrollY;
		const visible = rowModel.findVisibleRange({
			scrollTop: scrollTop - measurement.sectionTop,
			viewportHeight: measurement.viewportHeight,
			overscanPx: 0,
		});
		if (visible.start >= visible.end) return null;
		const row = rowModel.getRow(visible.start);
		const cell = row?.getCell(0);
		if (!row || !cell) return null;
		return {
			logicalKey: cell.logicalKey,
			rowTop: row.top,
			scrollTop,
			scrollRoot,
		};
	}

	function restoreLayoutAnchor(
		anchor: LayoutAnchor | null,
		nextRowModel: TwoHopRowModel,
	): number {
		if (!anchor || !rootEl) return 0;
		const ownerWindow = getOptionalOwnerWindow(rootEl);
		if (!ownerWindow) return 0;
		const currentScrollRoot = findNearestScrollContainer(rootEl);
		if (currentScrollRoot !== anchor.scrollRoot) return 0;
		const currentScrollTop = currentScrollRoot?.scrollTop ?? ownerWindow.scrollY;
		if (Math.abs(currentScrollTop - anchor.scrollTop) >= 0.5) return 0;
		const position = nextRowModel.resolveCellPosition(anchor.logicalKey);
		const nextRow = position ? nextRowModel.getRow(position.rowIndex) : null;
		if (!nextRow) return 0;
		const delta = nextRow.top - anchor.rowTop;
		if (Math.abs(delta) < 0.5) return 0;
		if (currentScrollRoot) currentScrollRoot.scrollTop += delta;
		else ownerWindow.scrollBy({ top: delta });
		return delta;
	}

	function resolveMeasuredLayout(rect: DOMRect): ViewPlanLayoutMetrics {
		if (!rootEl) return layout;
		const layoutBase = resolveCachedCardGridLayoutBase({
			rootEl,
			rootRect: rect,
			measuredWidth: rect.width > 0 ? rect.width : measurement.measuredWidth,
			defaults: DEFAULT_VIEW_PLAN_CARD_LAYOUT,
			listKind: "view-plan",
			scrollContainerEl: measurement.scrollContainerEl,
			configuredLayout,
		});
		return {
			containerWidth: layoutBase.containerWidth,
			columns: layoutBase.columns,
			cellWidth: layoutBase.cellWidth,
			rowHeight: layoutBase.rowHeight,
			gap: layoutBase.gap,
			sectionMarginBottom: Math.max(
				0,
				layoutBase.cardLayout.sectionMarginBottomPx,
			),
		};
	}

	function applyLayoutMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		if (!rootEl || !nextMeasurement.sectionRect) {
			scrollWindowController.resetLastScrollWindow();
			return "skipped";
		}
		const nextLayout = resolveMeasuredLayout(nextMeasurement.sectionRect);
		let effectiveMeasurement = nextMeasurement;
		if (!isSameViewPlanLayout(layout, nextLayout)) {
			const anchor = widthWasZero ? null : captureLayoutAnchor();
			layout = nextLayout;
			const nextRowModel = createTwoHopRowModel({
				documentIdentity: props.documentIdentity,
				sections: props.sections,
				layout: nextLayout,
			});
			rowModel = nextRowModel;
			const scrollDelta = restoreLayoutAnchor(anchor, nextRowModel);
			if (scrollDelta !== 0) {
				effectiveMeasurement = {
					...nextMeasurement,
					scrollTop: nextMeasurement.scrollTop + scrollDelta,
				};
			}
		}
		widthWasZero = false;
		const ranged = resolveRangedMeasurement(effectiveMeasurement, rowModel);
		const result = applyVirtualMeasurement(
			{ ...effectiveMeasurement, isScrollActive: false },
			rowModel,
			ranged.ranges,
		);
		if (result.kind !== "stable" || !effectiveMeasurement.isStableMeasurement) {
			scrollWindowController.resetLastScrollWindow();
			return "unstable";
		}
		scrollWindowController.primeLastScrollWindow(effectiveMeasurement, rowModel);
		measurementController.scheduleScrollMeasurementAfterLayout(
			effectiveMeasurement,
		);
		return "stable";
	}

	function applyMeasurement(
		nextMeasurement: VirtualMeasurement,
	): VirtualMeasurementApplicationResult {
		return nextMeasurement.source === "layout"
			? applyLayoutMeasurement(nextMeasurement)
			: scrollWindowController.applyScrollMeasurement(nextMeasurement, rowModel);
	}

	const measurementController = createVirtualMeasurementController({
		getRootEl: () => rootEl,
		measurement,
		hasRenderableContent: () => rowModel.rowCount > 0,
		onMeasurement: applyMeasurement,
		onObservedWidthChange: (width) => {
			if (width <= 0) widthWasZero = true;
		},
		getScrollMeasurementRange: scrollWindowController.getScrollMeasurementRange,
		enableBootstrapMeasurementSuppression: true,
		enableInitialStabilization: true,
		primeUnstableScrollStart: true,
		maxUnstableMeasurementRetries:
			CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
		frameCoordinator,
	});

	function publishSections(
		nextDocumentIdentity: string,
		nextSections: readonly TwoHopSectionModel[],
		identityChanged: boolean,
	): void {
		const anchor = identityChanged ? null : captureLayoutAnchor();
		if (identityChanged) {
			rowSlotAllocator.reset("source");
			cardHydrator.clear();
		}
		const nextRowModel = createTwoHopRowModel({
			documentIdentity: nextDocumentIdentity,
			sections: nextSections,
			layout,
		});
		rowModel = nextRowModel;
		restoreLayoutAnchor(anchor, nextRowModel);
		if (nextRowModel.rowCount === 0) {
			virtualList.setEmpty({ rowModel: nextRowModel });
		} else if (virtualList.getSnapshot()) {
			virtualList.recompute({ rowModel: nextRowModel });
		}
		cardHydrator.reconcileSource();
		scrollWindowController.resetLastScrollWindow();
		measurementController.runScrollMeasurement(undefined, {
			forcePublish: true,
			reason: "data-change",
		});
		measurementController.scheduleLayoutMeasurement();
	}

	$effect(() => {
		const nextDocumentIdentity = props.documentIdentity;
		const nextSections = props.sections;
		if (
			nextDocumentIdentity === lastDocumentIdentity &&
			nextSections === lastSections
		) {
			return;
		}
		const identityChanged = nextDocumentIdentity !== lastDocumentIdentity;
		lastDocumentIdentity = nextDocumentIdentity;
		lastSections = nextSections;
		untrack(() =>
			publishSections(nextDocumentIdentity, nextSections, identityChanged),
		);
	});

	$effect(() => {
		void configuredLayout;
		measurementController.scheduleLayoutMeasurement();
	});

	$effect(() => {
		const element = rootEl;
		if (!element) return;
		return measurementController.observeRoot(element, (callback) =>
			untrack(callback),
		);
	});

	$effect(() => {
		const revision = props.cardModelRevision;
		if (revision === lastCardModelRevision) return;
		lastCardModelRevision = revision;
		untrack(() => cardHydrator.refreshDemand());
	});

	$effect(() => {
		const nextDependencies = props.previewDependencies;
		if (nextDependencies === currentPreviewDependencies) return;
		currentPreviewDependencies = nextDependencies;
		previewSurface.replace(createPreviewSurface(nextDependencies));
		untrack(applyRangeEffects);
	});

	$effect(() => {
		void props.previewActive;
		untrack(applyRangeEffects);
	});

	onDestroy(() => {
		disposed = true;
		frameCoordinator.cancel("post-paint", RANGE_EFFECT_TASK_KEY);
		cardHydrator.dispose();
		previewSurface.dispose();
	});

	function flushVirtualScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void {
		flushCachedVirtualScrollMeasurement({
			measurement,
			snapshot,
			updateFromCachedMeasurement: (metrics) => {
				measurementController.runScrollMeasurement(metrics, {
					forcePublish: true,
				});
			},
		});
	}

	function resolveNavigationTarget(
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	) {
		return (
			rowModel.resolveNavigationTarget?.(
				currentKey,
				direction,
				currentPosition,
			) ?? null
		);
	}

	return {
		get rootEl() {
			return rootEl;
		},
		set rootEl(next: HTMLDivElement | null) {
			rootEl = next;
		},
		get contentEl() {
			return contentEl;
		},
		set contentEl(next: HTMLDivElement | null) {
			contentEl = next;
		},
		get interactionShadowRoot() {
			return interactionShadowRoot;
		},
		set interactionShadowRoot(next: ShadowRoot | null) {
			interactionShadowRoot = next;
		},
		get layout() {
			return layout;
		},
		get contentHeight() {
			return virtualList.getTotalHeight(rowModel.totalHeight);
		},
		get mountedRows() {
			return getMountedRows();
		},
		get observerRoot() {
			return measurement.scrollContainerEl;
		},
		get previewSurface() {
			return previewSurface;
		},
		get interactionDescriptorResolverProvider() {
			return cardHydrator.interactionDescriptorResolverProvider;
		},
		isPreviewHostEnabled(rowIndex: number): boolean {
			const mounted = virtualList.getSnapshot()?.ranges.mounted;
			return (
				isPreviewSurfaceActive() &&
				mounted !== undefined &&
				rowIndex >= mounted.start &&
				rowIndex < mounted.end
			);
		},
		registerCardModelConsumer: cardHydrator.registerConsumer,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement,
		loadMore(sectionId: string): void {
			props.loadMoreSection?.(sectionId);
		},
	};
}
