import { onDestroy, untrack } from "svelte";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import { useAppContext } from "cards/context/linkContext";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	createTwoHopRowModel,
	type TwoHopRowModel,
	type TwoHopVirtualCell,
} from "./rowModel";
import {
	buildMountedTwoHopRows,
	type MountedTwoHopBuild,
	type MountedTwoHopRow,
} from "./mountedRows";
import { DISABLED_PREVIEW_SURFACE } from "card-preview/runtime/disabledPreviewSurface";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "cards/layout/cardLayoutCssVars";
import {
	DEFAULT_TWO_HOP_GRID_LAYOUT,
	isSameTwoHopGridLayout,
	resolveTwoHopGridLayout,
	type TwoHopGridLayout,
} from "./layout";
import { useVirtualizer } from "cards/virtualization/public";
import type {
	ProgrammaticScrollSnapshot,
	VirtualMeasurement,
	VirtualNavigationTarget,
	VirtualSequentialNavigationTarget,
} from "cards/virtualization/public";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import type { InteractionDescriptorResolverProvider } from "cards/interactions/interactionRegistry";
import type { InteractionHandle } from "cards/interactions/interactionTypes";
import type { VirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";
import { createTwoHopAnchorRestorationController } from "./anchorRestoration";
import { createCardGridVisibilityPolicyResolver } from "cards/grid/model/cardGridVisibilityPolicy";
import { createTwoHopCardRuntime } from "./twoHopCardRuntime";
import type { Language } from "settings/model";

export interface TwoHopVirtualGridProps {
	readonly sections: readonly TwoHopSectionModel[];
	/**
	 * Identifies the logical result set. Section updates preserve their visible
	 * anchor only while this scope remains unchanged.
	 */
	readonly layoutAnchorScope: string;
	readonly applicationStore: CardCollectionState;
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

/** Public surface of the two-hop virtual grid, consumed by the Svelte view. */
export interface TwoHopVirtualGridController {
	rootEl: HTMLDivElement | null;
	readonly layout: TwoHopGridLayout;
	readonly contentHeight: number;
	readonly mountedRows: readonly MountedTwoHopRow[];
	readonly scrollContainerEl: HTMLElement | null;
	readonly previewSurface: VirtualPreviewSurface;
	readonly interactionDescriptorResolverProvider: InteractionDescriptorResolverProvider;

	isPreviewHostEnabled(rowIndex: number): boolean;
	getInteractionHandle(physicalCellSlot: number): InteractionHandle;
	registerCardModelConsumer(
		logicalKey: string,
		consumer: (model: CardRenderModel | undefined) => void,
	): () => void;
	resolveNavigationTarget(
		currentKey: string,
		direction: NavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null;
	resolveSequentialNavigationTarget(
		currentKey: string,
		direction: SequentialNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualSequentialNavigationTarget | null;
	shouldMoveFocusAboveGrid(
		currentKey: string,
		currentPosition: { rowIndex: number; columnIndex: number },
	): boolean;
	flushVirtualScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void;
	loadMore(sectionId: string): void;
}

/** Connects two-hop geometry and hydration to the shared bounded virtual-list runtime. */
export function useTwoHopVirtualGrid(
	props: TwoHopVirtualGridProps,
	frameCoordinator: VirtualFrameCoordinator,
): TwoHopVirtualGridController {
	const applicationStore = props.applicationStore;
	let layout = $state.raw<TwoHopGridLayout>(DEFAULT_TWO_HOP_GRID_LAYOUT);
	let rowModel = $state.raw<TwoHopRowModel>(
		createTwoHopRowModel({
			sections: props.sections,
			layout: DEFAULT_TWO_HOP_GRID_LAYOUT,
		}),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let widthWasZero = false;
	let interactionBindingRevision = $state(0);

	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const appContext = (() => {
		try {
			return useAppContext();
		} catch {
			return undefined;
		}
	})();
	const previewRuntime = appContext?.previewRuntime;
	const previewSurface = previewRuntime
		? previewRuntime.createSurface({
				frameCoordinator,
				resolveSearchMatchOffset: appContext?.resolveSearchMatchOffset,
			})
		: DISABLED_PREVIEW_SURFACE;

	function isPreviewSurfaceActive(): boolean {
		return previewRuntime !== undefined && props.previewActive !== false;
	}

	const resolveCardGridVisibilityPolicy = createCardGridVisibilityPolicyResolver();
	const resolveVisibilityPolicy = (model: TwoHopRowModel) =>
		resolveCardGridVisibilityPolicy(model.layout.rowStride);
	const cardSurfaceRuntime = createTwoHopCardRuntime({
		frameCoordinator,
		previewSurface,
		getMountedBuild: () => virtualizer.getMountedBuild(),
		getPreviewVisibleRange: () => virtualizer.getSnapshot()?.ranges.previewVisible,
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

	const virtualizer = useVirtualizer<
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
			anchorRestoration.scheduleAfterSnapshot();
		},
		resolveLayoutMeasurement,
		onObservedWidthChange: (width) => {
			if (width <= 0) {
				widthWasZero = true;
				anchorRestoration.discardPendingAnchor();
			}
		},
		frameCoordinator,
	});
	const measurement = virtualizer.measurement;
	const anchorRestoration = createTwoHopAnchorRestorationController({
		getRootEl: () => rootEl,
		getRowModel: () => rowModel,
		getMeasurement: () => measurement,
		isRowModelCommitted: () => virtualizer.getSnapshot()?.rowModel === rowModel,
		scheduleLayoutMeasurement: () => virtualizer.scheduleLayoutMeasurement(),
		suppressNextNativeScroll: (scrollTop) =>
			virtualizer.suppressNextNativeScroll(scrollTop),
		runDataChangeMeasurement: () => {
			virtualizer.runScrollMeasurement(undefined, "data-change");
		},
	});

	function getInteractionHandle(physicalCellSlot: number): InteractionHandle {
		void interactionBindingRevision;
		return cardSurfaceRuntime.getInteractionHandle(physicalCellSlot);
	}

	function resolveLayoutMeasurement(
		nextMeasurement: VirtualMeasurement & { readonly sectionRect: DOMRect },
	) {
		const nextLayout = rootEl
			? resolveTwoHopGridLayout({
					rootEl,
					sectionRect: nextMeasurement.sectionRect,
					measuredWidth: measurement.measuredWidth,
					configuredLayout,
				})
			: layout;
		if (!isSameTwoHopGridLayout(layout, nextLayout)) {
			if (!widthWasZero) anchorRestoration.preserveAnchor();
			layout = nextLayout;
			rowModel = createTwoHopRowModel({
				sections: props.sections,
				layout: nextLayout,
			});
		}
		widthWasZero = false;
		return {
			context: rowModel,
			measurement: nextMeasurement,
			isLayoutGeometryStable: nextMeasurement.hasValidScrollMetrics,
		};
	}

	function publishSections(
		nextSections: readonly TwoHopSectionModel[],
		preserveLayoutAnchor: boolean,
	): void {
		if (preserveLayoutAnchor) {
			anchorRestoration.preserveAnchor();
		} else {
			anchorRestoration.preserveScrollPosition();
		}

		const nextRowModel = createTwoHopRowModel({
			sections: nextSections,
			layout,
		});
		rowModel = nextRowModel;
		anchorRestoration.restoreAfterCommit();

		if (nextRowModel.rowCount === 0) {
			virtualizer.setEmpty({ rowModel: nextRowModel });
			return;
		}

		const publication = virtualizer.runScrollMeasurement(undefined, "data-change");
		if (publication.kind !== "measured") {
			virtualizer.scheduleLayoutMeasurement();
		}
	}

	function setupSectionSynchronization(): void {
		let lastSections = props.sections;
		let lastLayoutAnchorScope = props.layoutAnchorScope;
		$effect(() => {
			const nextSections = props.sections;
			const nextLayoutAnchorScope = props.layoutAnchorScope;
			if (nextSections === lastSections) return;
			const preserveLayoutAnchor =
				nextLayoutAnchorScope === lastLayoutAnchorScope;
			lastSections = nextSections;
			lastLayoutAnchorScope = nextLayoutAnchorScope;
			untrack(() => publishSections(nextSections, preserveLayoutAnchor));
		});
	}

	function setupLayoutSynchronization(): void {
		$effect(() => {
			void configuredLayout;
			virtualizer.scheduleLayoutMeasurement();
		});
	}

	function setupRootObservation(): void {
		$effect(() => {
			const element = rootEl;
			if (!element) return;
			return virtualizer.observeRoot(element, (callback) => untrack(callback));
		});
	}

	function setupCardModelSynchronization(): void {
		let lastCardModelRevision = props.cardModelRevision;
		$effect(() => {
			const revision = props.cardModelRevision;
			if (revision === lastCardModelRevision) return;
			lastCardModelRevision = revision;
			untrack(() => cardSurfaceRuntime.refreshDemand());
		});
	}

	function setupPreviewSynchronization(): void {
		$effect(() => {
			void props.previewActive;
			untrack(cardSurfaceRuntime.scheduleRangeEffects);
		});
	}

	setupSectionSynchronization();
	setupLayoutSynchronization();
	setupRootObservation();
	setupCardModelSynchronization();
	setupPreviewSynchronization();

	onDestroy(() => {
		anchorRestoration.dispose();
		cardSurfaceRuntime.dispose();
	});

	function flushVirtualScrollMeasurement(snapshot: ProgrammaticScrollSnapshot): void {
		virtualizer.flushProgrammaticScrollMeasurement(snapshot);
	}

	function resolveNavigationTarget(
		currentKey: string,
		direction: NavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null {
		return (
			rowModel.resolveNavigationTarget?.(
				currentKey,
				direction,
				currentPosition,
			) ?? null
		);
	}

	function resolveSequentialNavigationTarget(
		currentKey: string,
		direction: SequentialNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualSequentialNavigationTarget | null {
		return (
			rowModel.resolveSequentialNavigationTarget?.(
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
		return rowModel.shouldMoveFocusAboveGrid(currentKey, currentPosition);
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
			return virtualizer.getTotalHeight(rowModel.totalHeight);
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
			const mounted = virtualizer.getSnapshot()?.ranges.mounted;
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
