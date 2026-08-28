import { onDestroy, untrack } from "svelte";
import type { TFile } from "obsidian";
import type { SearchContentMatch } from "search/searchTypes";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import { createTwoHopRowModel, type TwoHopRowModel } from "./rowModel";
import {
	buildMountedTwoHopRows,
	type MountedTwoHopBuild,
	type MountedTwoHopCell,
	type MountedTwoHopRow,
} from "./rowModel";
import {
	createTwoHopCardHydrator,
	type TwoHopCardDemand,
	type TwoHopCardHydrationCell,
} from "./cardHydrator";
import type { PreviewRuntime } from "preview/runtime/previewRuntime";
import { DISABLED_PREVIEW_SURFACE } from "preview/runtime/previewRuntime";
import type { VirtualPreviewBinding } from "preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "cards/layout/cardLayoutCssVars";
import { resolveCardGridLayoutBase } from "cards/grid/layout/cardGridLayout";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "./rowModel";
import { findNearestScrollContainer } from "shared/ui/scroll/scrollContainer";
import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";
import { useVirtualizer } from "cards/virtualization/public";
import type { VirtualMeasurement } from "cards/virtualization/public";
import type { VirtualVisibilityPolicy } from "cards/virtualization/public";
import type { RowRange } from "cards/virtualization/public";
import { resolveVisibleRange } from "cards/virtualization/public";
import type { ResultNavigationDirection } from "cards/navigation/resultFocus";
import type { ProgrammaticScrollSnapshot } from "cards/virtualization/public";
import {
	resolvePreviewPrefetchRange,
	resolvePreviewScrollDirection,
	type PreviewScrollDirection,
} from "preview/prefetch/previewPrefetchRange";

/** Dependencies required to enable previews on the two-hop virtual surface. */
export interface TwoHopPreviewDependencies {
	readonly previewRuntime: PreviewRuntime;
	readonly resolveSearchMatchOffset: (
		query: string,
		file: TFile | null | undefined,
	) => SearchContentMatch | undefined;
}

export interface TwoHopVirtualGridProps {
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore: CardCollectionState;
	/** Fixed for the lifetime of the virtual surface. */
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly loadMoreSection?: (sectionId: string) => void;
	readonly previewActive?: boolean;
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
const EMPTY_MOUNTED_CELLS: readonly MountedTwoHopCell[] = [];
const RANGE_EFFECT_TASK_KEY = "two-hop-virtual-range-effects";

/** Connects two-hop geometry and hydration to the shared bounded virtual-list runtime. */
export function useTwoHopVirtualGrid(
	props: TwoHopVirtualGridProps,
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
	let lastSections = props.sections;
	let lastCardModelRevision = props.cardModelRevision;
	let widthWasZero = false;
	let disposed = false;
	let previousPreviewVisibleRange: RowRange | undefined;
	let previewScrollDirection: PreviewScrollDirection = "stationary";
	let previewVisibleRange: Readonly<RowRange> = EMPTY_RANGE;
	let previewPrefetchRange: Readonly<RowRange> = EMPTY_RANGE;

	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const previewDependencies = props.previewDependencies;
	const previewSurface = previewDependencies
		? previewDependencies.previewRuntime.createSurface({
				frameCoordinator,
				resolveSearchMatchOffset: previewDependencies.resolveSearchMatchOffset,
			})
		: DISABLED_PREVIEW_SURFACE;

	function isPreviewSurfaceActive(): boolean {
		return previewDependencies !== undefined && props.previewActive !== false;
	}

	// The policy derives only from rowStride, so the same object is reused
	// across scroll measurements instead of allocating one per measurement.
	let cachedVisibilityPolicyRowStride: number | undefined;
	let cachedVisibilityPolicy: VirtualVisibilityPolicy | undefined;
	function resolveVisibilityPolicy(model: TwoHopRowModel): VirtualVisibilityPolicy {
		const rowStride = model.layout.rowStride;
		if (rowStride !== cachedVisibilityPolicyRowStride || !cachedVisibilityPolicy) {
			cachedVisibilityPolicyRowStride = rowStride;
			cachedVisibilityPolicy = {
				bootstrapRows: 3,
				mountedOverscanPx: rowStride * 2,
				previewOverscanPx: 0,
			};
		}
		return cachedVisibilityPolicy;
	}

	const virtualList = useVirtualizer<
		ReturnType<TwoHopRowModel["getRow"]> extends infer TRow
			? TRow extends { getCell(columnIndex: number): infer TCell }
				? Exclude<TCell, null>
				: never
			: never,
		TwoHopRowModel,
		TwoHopRowModel,
		MountedTwoHopCell,
		MountedTwoHopBuild
	>({
		getRootEl: () => rootEl,
		getContext: () => rowModel,
		hasRenderableContent: () => rowModel.rowCount > 0,
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy,
		buildMountedCells: ({
			rowModel: nextRowModel,
			rowRange,
			previousBuild,
			rowSlotAllocator,
		}) =>
			buildMountedTwoHopRows({
				rowModel: nextRowModel,
				rowRange,
				previousBuild,
				rowSlotAllocator,
			}),
		onSnapshotUpdated: () => scheduleRangeEffects(),
		resolveLayoutMeasurement,
		onObservedWidthChange: (width) => {
			if (width <= 0) widthWasZero = true;
		},
		frameCoordinator,
	});
	const measurement = virtualList.measurement;

	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator,
		getRevision: () => untrack(() => props.cardModelRevision),
		resolveCardModel: props.resolveItemCardModel,
		isPreviewActive: isPreviewSurfaceActive,
		onPreviewModelsChanged: publishPreviewSnapshot,
	});

	function getMountedRows(): readonly MountedTwoHopRow[] {
		return virtualList.getMountedBuild()?.rowsByPhysicalSlot ?? EMPTY_MOUNTED_ROWS;
	}

	function getMountedCells(): readonly MountedTwoHopCell[] {
		return virtualList.getMountedBuild()?.cells ?? EMPTY_MOUNTED_CELLS;
	}

	function buildPreviewBindings(): VirtualPreviewBinding[] {
		if (!isPreviewSurfaceActive()) return [];
		const bindings: VirtualPreviewBinding[] = [];
		for (const row of getMountedRows()) {
			for (const mountedCell of row.bindings) {
				if (!mountedCell) continue;
				if (mountedCell.cell.kind !== "item") continue;
				const request = cardHydrator.getModel(
					mountedCell.cell.logicalKey,
				)?.previewRequest;
				if (!request) continue;
				bindings.push({
					key: mountedCell.cell.logicalKey,
					rowIndex: mountedCell.rowIndex,
					request,
				});
			}
		}
		return bindings;
	}

	function collectCardDemand(
		visibleRange: Readonly<RowRange>,
		prefetchRange: Readonly<RowRange>,
		includeBackground: boolean,
	): TwoHopCardDemand {
		const foreground: TwoHopCardHydrationCell[] = [];
		const prefetch: TwoHopCardHydrationCell[] = [];
		const background: TwoHopCardHydrationCell[] = [];
		for (const mountedCell of getMountedCells()) {
			if (mountedCell.cell.kind !== "item") continue;
			if (
				mountedCell.rowIndex >= visibleRange.start &&
				mountedCell.rowIndex < visibleRange.end
			) {
				foreground.push(mountedCell.cell);
			} else if (
				mountedCell.rowIndex >= prefetchRange.start &&
				mountedCell.rowIndex < prefetchRange.end
			) {
				prefetch.push(mountedCell.cell);
			} else if (includeBackground) {
				background.push(mountedCell.cell);
			}
		}
		foreground.push(...prefetch);
		return { foreground, background };
	}

	function publishPreviewSnapshot(): void {
		if (disposed) return;
		const active = isPreviewSurfaceActive();
		previewSurface.publish({
			bindings: buildPreviewBindings(),
			visibleRange: previewVisibleRange,
			prefetchRange: previewPrefetchRange,
			active,
		});
	}

	function applyRangeEffects(): void {
		if (disposed) return;
		const snapshot = virtualList.getSnapshot();
		previewVisibleRange = snapshot?.ranges.previewVisible ?? EMPTY_RANGE;
		previewScrollDirection = resolvePreviewScrollDirection(
			previousPreviewVisibleRange,
			previewVisibleRange,
			previewScrollDirection,
		);
		previousPreviewVisibleRange = previewVisibleRange;
		const active = isPreviewSurfaceActive();
		previewPrefetchRange = active
			? resolvePreviewPrefetchRange(
					previewVisibleRange,
					rowModel.rowCount,
					previewScrollDirection,
				)
			: previewVisibleRange;
		cardHydrator.setDemand(
			collectCardDemand(previewVisibleRange, previewPrefetchRange, active),
		);
		publishPreviewSnapshot();
	}

	function scheduleRangeEffects(): void {
		frameCoordinator.schedule(
			"post-paint",
			RANGE_EFFECT_TASK_KEY,
			applyRangeEffects,
		);
	}

	function captureLayoutAnchor(): LayoutAnchor | null {
		if (!rootEl || measurement.viewportHeight <= 0) return null;
		const scrollRoot = measurement.scrollContainerEl;
		const ownerWindow = getOptionalOwnerWindow(rootEl);
		if (!ownerWindow) return null;
		const scrollTop = scrollRoot?.scrollTop ?? ownerWindow.scrollY;
		const visible = resolveVisibleRange(rowModel, {
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
		const layoutBase = resolveCardGridLayoutBase({
			rootEl,
			rootRect: rect,
			measuredWidth: rect.width > 0 ? rect.width : measurement.measuredWidth,
			defaults: DEFAULT_VIEW_PLAN_CARD_LAYOUT,
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
		};
	}

	function publishSections(nextSections: readonly TwoHopSectionModel[]): void {
		const anchor = captureLayoutAnchor();
		const nextRowModel = createTwoHopRowModel({
			sections: nextSections,
			layout,
		});
		rowModel = nextRowModel;
		restoreLayoutAnchor(anchor, nextRowModel);
		if (nextRowModel.rowCount === 0) {
			virtualList.setEmpty({ rowModel: nextRowModel });
			return;
		}

		const publication = virtualList.runScrollMeasurement(undefined, {
			forcePublish: true,
			reason: "data-change",
		});
		if (publication.kind !== "measured") {
			virtualList.scheduleLayoutMeasurement();
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
		virtualList.scheduleLayoutMeasurement();
	});

	$effect(() => {
		const element = rootEl;
		if (!element) return;
		return virtualList.observeRoot(element, (callback) => untrack(callback));
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
		virtualList.flushProgrammaticScrollMeasurement(snapshot, {
			forcePublish: true,
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
			frameCoordinator.bindOwnerElement?.(next);
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
		get scrollContainerEl() {
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
