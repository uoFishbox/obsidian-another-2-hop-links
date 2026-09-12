import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type { InteractionHandle } from "cards/interactions/interactionTypes";
import type { InteractionDescriptorResolverProvider } from "cards/interactions/interactionRegistry";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";
import type { VirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";
import { createPreviewPrefetchRangeTracker } from "card-preview/prefetch/previewPrefetchRange";
import type { RowRange } from "cards/virtualization/public";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import type { TwoHopItemModel } from "two-hop/ui/twoHopSectionModel";
import { createTwoHopCardHydrator, type TwoHopCardHydrator } from "./cardHydrator";
import {
	buildTwoHopInteractionBindings,
	collectTwoHopCardDemand,
	createTwoHopPreviewBindingsMemo,
} from "./mountedCardBindings";
import type { MountedTwoHopBuild, MountedTwoHopRow } from "./mountedRows";

const EMPTY_RANGE: Readonly<RowRange> = Object.freeze({ start: 0, end: 0 });
const EMPTY_MOUNTED_ROWS: readonly MountedTwoHopRow[] = [];
const RANGE_EFFECT_TASK_KEY = "two-hop-virtual-range-effects";

export interface TwoHopCardSurfaceRuntimeOptions {
	readonly frameCoordinator: VirtualFrameCoordinator;
	readonly previewSurface: VirtualPreviewSurface;
	getMountedBuild(): MountedTwoHopBuild | null;
	getPreviewVisibleRange(): Readonly<RowRange> | undefined;
	getRowCount(): number;
	getCardDimensions(): { readonly widthPx: number; readonly heightPx: number };
	getRevision(): unknown;
	isPreviewActive(): boolean;
	resolveCardModel(item: TwoHopItemModel, revision: unknown): CardRenderModel;
	onInteractionHandlesChanged(): void;
}

/** Runtime surface consumed by the two-hop virtual grid controller. */
export interface TwoHopCardSurfaceRuntime {
	readonly previewSurface: VirtualPreviewSurface;
	readonly interactionDescriptorResolverProvider: InteractionDescriptorResolverProvider;
	getMountedRows(): readonly MountedTwoHopRow[];
	onSnapshotUpdated(mountedBuild: MountedTwoHopBuild | null): void;
	scheduleRangeEffects(): void;
	refreshDemand(): void;
	registerCardModelConsumer(
		logicalKey: string,
		consumer: (model: CardRenderModel | undefined) => void,
	): () => void;
	getInteractionHandle(physicalCellSlot: number): InteractionHandle;
	dispose(): void;
}

/** Owns two-hop hydration, preview ranges, and physical-slot interactions. */
export function createTwoHopCardSurfaceRuntime(
	options: TwoHopCardSurfaceRuntimeOptions,
): TwoHopCardSurfaceRuntime {
	let disposed = false;
	let previewVisibleRange: Readonly<RowRange> = EMPTY_RANGE;
	let previewPrefetchRange: Readonly<RowRange> = EMPTY_RANGE;
	let lastInteractionMountedBuild: MountedTwoHopBuild | null | undefined;
	let previewModelRevision = 0;
	const previewPrefetchRangeTracker = createPreviewPrefetchRangeTracker();
	const resolvePreviewBindings = createTwoHopPreviewBindingsMemo();
	const interactionController = createVirtualCardInteractionController();
	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator: options.frameCoordinator,
		getRevision: options.getRevision,
		resolveCardModel: options.resolveCardModel,
		isPreviewActive: options.isPreviewActive,
		onModelsChanged: syncHydratedInteractions,
		onPreviewModelsChanged: () => {
			previewModelRevision += 1;
			publishPreviewSnapshot();
		},
	});

	function getMountedRows(): readonly MountedTwoHopRow[] {
		return options.getMountedBuild()?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS;
	}

	function syncMountedInteractions(
		mountedBuild: MountedTwoHopBuild | null,
		force = false,
	): void {
		if (disposed || (!force && mountedBuild === lastInteractionMountedBuild))
			return;
		lastInteractionMountedBuild = mountedBuild;
		const handlesChanged = interactionController.syncCards(
			buildTwoHopInteractionBindings(
				mountedBuild?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS,
				cardHydrator.getModel,
			),
		);
		if (handlesChanged) options.onInteractionHandlesChanged();
	}

	function syncHydratedInteractions(): void {
		syncMountedInteractions(options.getMountedBuild(), true);
	}

	function publishPreviewSnapshot(): void {
		if (disposed) return;
		const active = options.isPreviewActive();
		const dimensions = options.getCardDimensions();
		options.previewSurface.publish({
			bindings: resolvePreviewBindings({
				mountedBuild: options.getMountedBuild(),
				modelRevision: previewModelRevision,
				widthPx: dimensions.widthPx,
				heightPx: dimensions.heightPx,
				active,
				getCardModel: cardHydrator.getModel,
			}),
			visibleRange: previewVisibleRange,
			prefetchRange: previewPrefetchRange,
			active,
		});
	}

	function applyRangeEffects(): void {
		if (disposed) return;
		previewVisibleRange = options.getPreviewVisibleRange() ?? EMPTY_RANGE;
		const active = options.isPreviewActive();
		const resolvedPrefetchRange = previewPrefetchRangeTracker.resolve(
			previewVisibleRange,
			options.getRowCount(),
		);
		previewPrefetchRange = active ? resolvedPrefetchRange : previewVisibleRange;
		cardHydrator.setDemand(
			collectTwoHopCardDemand(
				getMountedRows(),
				previewVisibleRange,
				previewPrefetchRange,
				active,
			),
		);
		publishPreviewSnapshot();
	}

	function scheduleRangeEffects(): void {
		options.frameCoordinator.schedule(
			"post-paint",
			RANGE_EFFECT_TASK_KEY,
			applyRangeEffects,
		);
	}

	function onSnapshotUpdated(mountedBuild: MountedTwoHopBuild | null): void {
		syncMountedInteractions(mountedBuild);
		scheduleRangeEffects();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		options.frameCoordinator.cancel("post-paint", RANGE_EFFECT_TASK_KEY);
		cardHydrator.dispose();
		interactionController.clear();
		options.previewSurface.dispose();
	}

	return {
		previewSurface: options.previewSurface,
		interactionDescriptorResolverProvider: interactionController,
		getMountedRows,
		onSnapshotUpdated,
		scheduleRangeEffects,
		refreshDemand: cardHydrator.refreshDemand,
		registerCardModelConsumer: cardHydrator.registerConsumer,
		getInteractionHandle: (physicalCellSlot) =>
			interactionController.getInteractionHandle(String(physicalCellSlot)),
		dispose,
	};
}
