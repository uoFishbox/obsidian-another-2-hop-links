import { onDestroy, untrack } from "svelte";
import type { Pos, TFile } from "obsidian";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
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
import {
	createTwoHopCardHydrator,
	type TwoHopCardDemand,
	type TwoHopCardHydrationCell,
} from "features/two-hop/ui/twoHopCardHydrator";
import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";
import { DISABLED_PREVIEW_SURFACE } from "features/card-preview/runtime/previewRuntime";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { resolveCachedCardGridLayoutBase } from "ui/virtualization/dom/virtualListCardLayout";
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
import { type VirtualMeasurement } from "ui/virtualization/dom/virtualMeasurementController";
import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
} from "ui/virtualization/core/scrollWindowGate";
import { createVirtualListControllerAdapter } from "ui/virtualization/svelte/virtualListControllerAdapter";
import type { VirtualVisibilityPolicy } from "ui/virtualization/core/virtualListEngine";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualRanges } from "ui/virtualization/types";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { ProgrammaticScrollSnapshot } from "ui/virtualization/dom/flushVirtualScrollMeasurement";
import { flushVirtualScrollMeasurement as flushCachedVirtualScrollMeasurement } from "ui/virtualization/dom/flushVirtualScrollMeasurement";
import { publishTwoHopCardCounts } from "infrastructure/debug/twoHopCardCountRegistry";

/** Dependencies required to enable previews on the two-hop virtual surface. */
export interface TwoHopPreviewDependencies {
	readonly previewRuntime: PreviewRuntime;
	readonly resolveSearchMatchPosition: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
}

export interface TwoHopVirtualListProps {
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore: ApplicationStore;
	/** Fixed for the lifetime of the virtual surface. */
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly loadMoreSection?: (sectionId: string) => void;
	readonly previewActive?: boolean;
	readonly offscreenBootstrapPreviewRows?: number;
	readonly cardModelRevision: unknown;
	readonly resolveItemCardModel: (
		item: TwoHopItemModel,
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
			sections: props.sections,
			layout: DEFAULT_VIEW_PLAN_LAYOUT,
		}),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let measurement = $state(createVirtualListMeasurementState());
	let lastSections = props.sections;
	let lastCardModelRevision = props.cardModelRevision;
	let widthWasZero = false;
	let disposed = false;

	const rowSlotAllocator = createResidentRowSlotAllocator();
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const previewDependencies = props.previewDependencies;
	const previewSurface = previewDependencies
		? previewDependencies.previewRuntime.createSurface({
				frameCoordinator,
				resolveSearchMatchPosition:
					previewDependencies.resolveSearchMatchPosition,
			})
		: DISABLED_PREVIEW_SURFACE;

	function isPreviewSurfaceActive(): boolean {
		return previewDependencies !== undefined && props.previewActive !== false;
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
		buildMountedCells: ({ rowModel: nextRowModel, rowRange, previousBuild }) =>
			buildMountedTwoHopRows({
				rowModel: nextRowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		mountedRowsReconciler: rowSlotAllocator,
		onStableVisibleRange: () => {
			measurement.hasStableVisibleRange = true;
		},
		onSnapshotUpdated: () => scheduleRangeEffects(),
	});

	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator,
		getRevision: () => untrack(() => props.cardModelRevision),
		resolveCardModel: props.resolveItemCardModel,
		isPreviewActive: isPreviewSurfaceActive,
		onPreviewModelsChanged: publishPreviewSnapshot,
	});

	function getMountedRows(): readonly MountedTwoHopRow[] {
		return (
			virtualList.getReconciliationState().mountedBuild?.rowsBySlot ??
			EMPTY_MOUNTED_ROWS
		);
	}

	function publishPreviewBindings(): void {
		previewSurface.beginBindings();
		if (!isPreviewSurfaceActive()) {
			previewSurface.endBindings();
			return;
		}
		for (const row of getMountedRows()) {
			for (const mountedCell of row.cells) {
				if (mountedCell.cell.kind !== "item") continue;
				const request = cardHydrator.getModel(
					mountedCell.cell.logicalKey,
				)?.previewRequest;
				if (!request) continue;
				previewSurface.bindSlot(
					String(mountedCell.renderSlotKey),
					mountedCell.rowIndex,
					mountedCell.cell.logicalKey,
					request,
				);
			}
		}
		previewSurface.endBindings();
	}

	function collectCardDemand(
		foregroundRange: Readonly<RowRange>,
		includeBackground: boolean,
	): TwoHopCardDemand {
		const foreground: TwoHopCardHydrationCell[] = [];
		const background: TwoHopCardHydrationCell[] = [];
		for (const row of getMountedRows()) {
			for (const mountedCell of row.cells) {
				if (mountedCell.cell.kind !== "item") continue;
				if (
					mountedCell.rowIndex >= foregroundRange.start &&
					mountedCell.rowIndex < foregroundRange.end
				) {
					foreground.push(mountedCell.cell);
				} else if (includeBackground) {
					background.push(mountedCell.cell);
				}
			}
		}
		return { foreground, background };
	}

	function publishPreviewSnapshot(): void {
		if (disposed) return;
		const snapshot = virtualList.getSnapshot();
		const active = isPreviewSurfaceActive();
		const range = snapshot?.ranges.previewVisible ?? EMPTY_RANGE;
		publishPreviewBindings();
		previewSurface.setActiveRange(range.start, range.end, active);
	}

	function applyRangeEffects(): void {
		if (disposed) return;
		const snapshot = virtualList.getSnapshot();
		const foreground = snapshot?.ranges.previewVisible ?? EMPTY_RANGE;
		cardHydrator.setDemand(collectCardDemand(foreground, isPreviewSurfaceActive()));
		publishPreviewSnapshot();
	}

	function scheduleRangeEffects(): void {
		frameCoordinator.schedule(
			"post-paint",
			RANGE_EFFECT_TASK_KEY,
			applyRangeEffects,
		);
	}

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

	function transformMountedMeasurement(
		resolved: MountedScrollWindowMeasurement,
		nextMeasurement: VirtualMeasurement,
		model: TwoHopRowModel,
	): MountedScrollWindowMeasurement {
		if (!shouldUseOffscreenBootstrap(nextMeasurement, model)) return resolved;
		return { ...resolved, mounted: resolveOffscreenBootstrapRange(model) };
	}

	function transformRangedMeasurement(
		resolved: RangedScrollWindowMeasurement,
		nextMeasurement: VirtualMeasurement,
		model: TwoHopRowModel,
	): RangedScrollWindowMeasurement {
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

	function resolveLayoutMeasurement(
		nextMeasurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
	) {
		const nextLayout = resolveMeasuredLayout(nextMeasurement.sectionRect);
		let effectiveMeasurement = nextMeasurement;
		if (!isSameViewPlanLayout(layout, nextLayout)) {
			const anchor = widthWasZero ? null : captureLayoutAnchor();
			layout = nextLayout;
			const nextRowModel = createTwoHopRowModel({
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
		return {
			context: rowModel,
			measurement: effectiveMeasurement,
			isStable: effectiveMeasurement.isStableMeasurement,
			precomputeRanges: true,
		};
	}

	const virtualListController = createVirtualListControllerAdapter<
		TwoHopRowModel,
		TwoHopRowModel
	>({
		getRootEl: () => rootEl,
		measurement,
		getContext: () => rowModel,
		hasRenderableContent: () => rowModel.rowCount > 0,
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy,
		applyRangeMeasurement: applyVirtualMeasurement,
		resolveLayoutMeasurement,
		transformMountedScrollWindowMeasurement: transformMountedMeasurement,
		transformRangedScrollWindowMeasurement: transformRangedMeasurement,
		onObservedWidthChange: (width) => {
			if (width <= 0) widthWasZero = true;
		},
		frameCoordinator,
	});

	function publishSections(nextSections: readonly TwoHopSectionModel[]): void {
		const anchor = captureLayoutAnchor();
		const nextRowModel = createTwoHopRowModel({
			sections: nextSections,
			layout,
		});
		rowModel = nextRowModel;
		if (rootEl) publishTwoHopCardCounts(rootEl, nextRowModel.cardCounts);
		restoreLayoutAnchor(anchor, nextRowModel);
		if (nextRowModel.rowCount === 0) {
			virtualList.setEmpty({ rowModel: nextRowModel });
			return;
		}

		const publication = virtualListController.runScrollMeasurement(undefined, {
			forcePublish: true,
			reason: "data-change",
		});
		if (publication.kind !== "measured") {
			virtualListController.scheduleLayoutMeasurement();
		}
	}

	$effect(() => {
		const nextSections = props.sections;
		if (nextSections === lastSections) return;
		lastSections = nextSections;
		untrack(() => publishSections(nextSections));
	});

	$effect(() => {
		void configuredLayout;
		virtualListController.scheduleLayoutMeasurement();
	});

	$effect(() => {
		const element = rootEl;
		if (!element) return;
		return virtualListController.observeRoot(element, (callback) =>
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
		void props.previewActive;
		untrack(scheduleRangeEffects);
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
				virtualListController.runScrollMeasurement(metrics, {
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
			if (next) publishTwoHopCardCounts(next, rowModel.cardCounts);
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
