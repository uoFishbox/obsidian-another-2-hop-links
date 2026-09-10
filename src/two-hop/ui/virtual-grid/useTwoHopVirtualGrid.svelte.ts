import { onDestroy, tick, untrack } from "svelte";
import type { TFile } from "obsidian";
import type { SearchContentMatch } from "search/searchTypes";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	createTwoHopRowModel,
	type TwoHopRowModel,
	type TwoHopVirtualCell,
} from "./rowModel";
import { buildMountedTwoHopRows, type MountedTwoHopBuild } from "./mountedRows";
import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
import { DISABLED_PREVIEW_SURFACE } from "card-preview/runtime/previewRuntime";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "cards/layout/cardLayoutCssVars";
import { resolveCardGridLayoutBase } from "cards/grid/layout/cardGridLayout";
import {
	DEFAULT_TWO_HOP_GRID_CARD_LAYOUT,
	DEFAULT_TWO_HOP_GRID_LAYOUT,
	isSameTwoHopGridLayout,
	type TwoHopGridLayout,
} from "./rowModel";
import { useVirtualizer } from "cards/virtualization/public";
import type { VirtualMeasurement } from "cards/virtualization/public";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import type { ProgrammaticScrollSnapshot } from "cards/virtualization/public";
import {
	captureTwoHopLayoutAnchor,
	restoreTwoHopLayoutAnchor,
	type TwoHopLayoutAnchor,
} from "./layoutAnchor";
import { createCardGridVisibilityPolicyResolver } from "cards/grid/model/cardGridVisibilityPolicy";
import type { InteractionHandle } from "cards/interactions/interactionTypes";
import { createTwoHopCardSurfaceRuntime } from "./twoHopCardSurfaceRuntime";
import type { Language } from "settings/model";

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
	/** Moves focus from the first card row to the controls above the grid. */
	readonly onMoveFocusAboveGrid?: () => boolean | Promise<boolean>;
	readonly resolveItemCardModel: (
		item: TwoHopItemModel,
		revision: unknown,
	) => CardRenderModel;
	readonly language?: Language;
}

/** Connects two-hop geometry and hydration to the shared bounded virtual-list runtime. */
export function useTwoHopVirtualGrid(
	props: TwoHopVirtualGridProps,
	frameCoordinator: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	let layout = $state.raw<TwoHopGridLayout>(DEFAULT_TWO_HOP_GRID_LAYOUT);
	let rowModel = $state.raw<TwoHopRowModel>(
		createTwoHopRowModel({
			sections: props.sections,
			layout: DEFAULT_TWO_HOP_GRID_LAYOUT,
		}),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let lastSections = props.sections;
	let lastCardModelRevision = props.cardModelRevision;
	let widthWasZero = false;
	let disposed = false;
	let pendingLayoutAnchor: TwoHopLayoutAnchor | null = null;
	let postCommitMeasurementScheduled = false;
	let interactionBindingRevision = $state(0);

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

	const resolveCardGridVisibilityPolicy = createCardGridVisibilityPolicyResolver();
	const resolveVisibilityPolicy = (model: TwoHopRowModel) =>
		resolveCardGridVisibilityPolicy(model.layout.rowStride);
	const cardSurfaceRuntime = createTwoHopCardSurfaceRuntime({
		frameCoordinator,
		previewSurface,
		getMountedBuild: () => virtualList.getMountedBuild(),
		getPreviewVisibleRange: () => virtualList.getSnapshot()?.ranges.previewVisible,
		getRowCount: () => rowModel.rowCount,
		getCardDimensions: () => ({
			widthPx: layout.cellWidth,
			heightPx: layout.rowHeight,
		}),
		getRevision: () => untrack(() => props.cardModelRevision),
		resolveCardModel: props.resolveItemCardModel,
		isPreviewActive: isPreviewSurfaceActive,
		onInteractionHandlesChanged: () => {
			interactionBindingRevision += 1;
		},
	});

	const virtualList = useVirtualizer<
		TwoHopVirtualCell,
		TwoHopRowModel,
		TwoHopRowModel,
		MountedTwoHopBuild
	>({
		getRootEl: () => rootEl,
		getContext: () => rowModel,
		hasRenderableContent: () => rowModel.rowCount > 0,
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy,
		buildMountedRows: ({
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
		onSnapshotUpdated: (snapshot) => {
			cardSurfaceRuntime.onSnapshotUpdated(snapshot.mountedBuild);
			scheduleAnchorRestoration();
		},
		resolveLayoutMeasurement,
		onObservedWidthChange: (width) => {
			if (width <= 0) {
				widthWasZero = true;
				pendingLayoutAnchor = null;
			}
		},
		frameCoordinator,
	});
	const measurement = virtualList.measurement;

	function getInteractionHandle(physicalCellSlot: number): InteractionHandle {
		void interactionBindingRevision;
		return cardSurfaceRuntime.getInteractionHandle(physicalCellSlot);
	}

	function resolveTwoHopGridLayout(rect: DOMRect): TwoHopGridLayout {
		if (!rootEl) return layout;
		const layoutBase = resolveCardGridLayoutBase({
			rootEl,
			rootRect: rect,
			measuredWidth: rect.width > 0 ? rect.width : measurement.measuredWidth,
			defaults: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT,
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
		const nextLayout = resolveTwoHopGridLayout(nextMeasurement.sectionRect);
		if (!isSameTwoHopGridLayout(layout, nextLayout)) {
			if (!widthWasZero) capturePendingLayoutAnchor();
			layout = nextLayout;
			const nextRowModel = createTwoHopRowModel({
				sections: props.sections,
				layout: nextLayout,
			});
			rowModel = nextRowModel;
		}
		widthWasZero = false;
		return {
			context: rowModel,
			measurement: nextMeasurement,
			isLayoutGeometryStable: nextMeasurement.hasValidScrollMetrics,
		};
	}

	function capturePendingLayoutAnchor(): void {
		pendingLayoutAnchor ??= captureTwoHopLayoutAnchor(
			rootEl,
			rowModel,
			measurement,
		);
	}

	function scheduleAnchorRestoration(): void {
		if (!pendingLayoutAnchor) return;
		schedulePostCommitMeasurement();
	}

	function schedulePostCommitMeasurement(): void {
		if (postCommitMeasurementScheduled) return;
		postCommitMeasurementScheduled = true;
		// The committed content height must reach the DOM before scrollTop can
		// reflect its new clamp. Coalesce intervening data and layout updates.
		void tick().then(runPostCommitMeasurement);
	}

	function runPostCommitMeasurement(): void {
		postCommitMeasurementScheduled = false;
		if (disposed) return;
		if (virtualList.getSnapshot()?.rowModel !== rowModel) {
			virtualList.scheduleLayoutMeasurement();
			return;
		}
		const anchor = pendingLayoutAnchor;
		pendingLayoutAnchor = null;
		if (anchor) {
			const delta = restoreTwoHopLayoutAnchor(anchor, rootEl, rowModel);
			if (delta !== 0) {
				virtualList.suppressNextNativeScroll(anchor.scrollTop + delta);
			}
		}
		// A shorter DOM can clamp scrolling even when no anchor can be captured.
		virtualList.runScrollMeasurement(undefined, "data-change");
	}

	function publishSections(nextSections: readonly TwoHopSectionModel[]): void {
		capturePendingLayoutAnchor();
		const nextRowModel = createTwoHopRowModel({
			sections: nextSections,
			layout,
		});
		rowModel = nextRowModel;
		schedulePostCommitMeasurement();
		if (nextRowModel.rowCount === 0) {
			virtualList.setEmpty({ rowModel: nextRowModel });
			return;
		}

		const publication = virtualList.runScrollMeasurement(undefined, "data-change");
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
		untrack(() => cardSurfaceRuntime.refreshDemand());
	});

	$effect(() => {
		void props.previewActive;
		untrack(cardSurfaceRuntime.scheduleRangeEffects);
	});

	onDestroy(() => {
		disposed = true;
		pendingLayoutAnchor = null;
		cardSurfaceRuntime.dispose();
	});

	function flushVirtualScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void {
		virtualList.flushProgrammaticScrollMeasurement(snapshot);
	}

	function resolveNavigationTarget(
		currentKey: string,
		direction: NavigationDirection,
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

	function shouldMoveFocusAboveGrid(
		currentKey: string,
		currentPosition: { rowIndex: number; columnIndex: number },
	): boolean {
		const currentCell = rowModel
			.getRow(currentPosition.rowIndex)
			?.getCell(currentPosition.columnIndex);
		if (
			!currentCell ||
			currentCell.logicalKey !== currentKey ||
			currentCell.kind !== "item"
		) {
			return false;
		}

		for (let rowIndex = 0; rowIndex < currentPosition.rowIndex; rowIndex += 1) {
			const row = rowModel.getRow(rowIndex);
			if (!row) continue;
			for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
				if (row.getCell(columnIndex)?.kind === "item") return false;
			}
		}
		return true;
	}

	function resolveSequentialNavigationTarget(
		currentKey: string,
		direction: SequentialNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	) {
		return (
			rowModel.resolveSequentialNavigationTarget?.(
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
			return cardSurfaceRuntime.getMountedRows();
		},
		get scrollContainerEl() {
			return measurement.scrollContainerEl;
		},
		get previewSurface() {
			return cardSurfaceRuntime.previewSurface;
		},
		get interactionDescriptorResolverProvider() {
			return cardSurfaceRuntime.interactionDescriptorResolverProvider;
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
		registerCardModelConsumer: cardSurfaceRuntime.registerCardModelConsumer,
		getInteractionHandle,
		resolveNavigationTarget,
		resolveSequentialNavigationTarget,
		shouldMoveFocusAboveGrid,
		flushVirtualScrollMeasurement,
		loadMore(sectionId: string): void {
			props.loadMoreSection?.(sectionId);
		},
	};
}
