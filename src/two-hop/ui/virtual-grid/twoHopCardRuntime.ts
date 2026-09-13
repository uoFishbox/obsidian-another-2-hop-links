import { applyCardPreviewDimensions } from "card-preview/pipeline/cardPreviewRequest";
import { createPreviewPrefetchRangeTracker } from "card-preview/prefetch/previewPrefetchRange";
import type {
	VirtualPreviewBinding,
	VirtualPreviewSurface,
} from "card-preview/scheduling/virtualPreviewSurface";
import type { InteractionDescriptorResolverProvider } from "cards/interactions/interactionRegistry";
import type {
	InteractionHandle,
	ItemInteractionDescriptor,
} from "cards/interactions/interactionTypes";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type { RowRange } from "cards/virtualization/public";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import type { TwoHopItemModel } from "two-hop/ui/twoHopSectionModel";
import type {
	MountedTwoHopBuild,
	MountedTwoHopCell,
	MountedTwoHopRow,
} from "./mountedRows";
import type { TwoHopVirtualCell } from "./rowModel";

const EMPTY_RANGE: Readonly<RowRange> = Object.freeze({ start: 0, end: 0 });
const EMPTY_MOUNTED_ROWS: readonly MountedTwoHopRow[] = [];
const EMPTY_PREVIEW_BINDINGS: readonly VirtualPreviewBinding[] = [];
const RANGE_EFFECT_TASK_KEY = "two-hop-virtual-range-effects";
const HYDRATION_TASK_KEY = "two-hop-card-hydration";
const MAX_MODELS_PER_DRAIN = 8;
const MAX_HYDRATION_CPU_MS = 1;
const MAX_RETAINED_CARD_MODELS = 64;

type CardModelConsumer = (model: CardRenderModel | undefined) => void;
type HydrationPriority = "foreground" | "background";
type TwoHopCardHydrationCell = Extract<TwoHopVirtualCell, { kind: "item" }>;

interface HydratedCardEntry {
	readonly item: TwoHopItemModel;
	readonly revision: unknown;
	readonly model: CardRenderModel;
}

interface HydrationQueue {
	readonly entries: TwoHopCardHydrationCell[];
	head: number;
}

export interface TwoHopCardRuntimeOptions {
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

/** Card-facing runtime owned by the two-hop virtual grid controller. */
export interface TwoHopCardRuntime {
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

/**
 * Owns two-hop hydration queues, the card-model cache, preview publication, and
 * physical-slot interactions. Hydration demand is rebuilt directly from the
 * resident mounted rows so a range update never materializes a demand object.
 */
export function createTwoHopCardRuntime(
	options: TwoHopCardRuntimeOptions,
): TwoHopCardRuntime {
	let disposed = false;
	let previewVisibleRange: Readonly<RowRange> = EMPTY_RANGE;
	let previewPrefetchRange: Readonly<RowRange> = EMPTY_RANGE;
	let lastInteractionMountedBuild: MountedTwoHopBuild | null | undefined;
	let lastPreviewMountedBuild: MountedTwoHopBuild | null | undefined;
	let previewBindingsDirty = true;
	let previewBindings: readonly VirtualPreviewBinding[] = EMPTY_PREVIEW_BINDINGS;
	let lastPreviewWidthPx: number | undefined;
	let lastPreviewHeightPx: number | undefined;
	let previewWasActive = false;

	const previewPrefetchRangeTracker = createPreviewPrefetchRangeTracker();
	const interactionController = createVirtualCardInteractionController();
	const modelCache = new Map<string, HydratedCardEntry>();
	const modelConsumers = new Map<string, CardModelConsumer>();
	const demandedKeys = new Set<string>();
	const foregroundQueue = createHydrationQueue();
	const backgroundQueue = createHydrationQueue();
	let scheduledPriority: HydrationPriority | undefined;

	function getMountedRows(): readonly MountedTwoHopRow[] {
		return options.getMountedBuild()?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS;
	}

	function notify(logicalKey: string, model: CardRenderModel | undefined): void {
		modelConsumers.get(logicalKey)?.(model);
	}

	function registerCardModelConsumer(
		logicalKey: string,
		consumer: CardModelConsumer,
	): () => void {
		modelConsumers.set(logicalKey, consumer);
		consumer(modelCache.get(logicalKey)?.model);
		return () => {
			if (modelConsumers.get(logicalKey) === consumer) {
				modelConsumers.delete(logicalKey);
			}
		};
	}

	/**
	 * Rebuilds both hydration queues from the latest mounted snapshot.
	 * Foreground holds visible and prefetch cells; background holds the rest of
	 * the resident window while previews are active. Replacing the queues here
	 * drops all pending work from superseded scroll windows.
	 */
	function rebuildHydrationQueues(
		refreshExisting: boolean,
		includeBackground: boolean,
	): void {
		clearHydrationQueue(foregroundQueue);
		clearHydrationQueue(backgroundQueue);
		demandedKeys.clear();
		const revision = options.getRevision();
		const visibleStart = previewVisibleRange.start;
		const visibleEnd = previewVisibleRange.end;
		const prefetchStart = previewPrefetchRange.start;
		const prefetchEnd = previewPrefetchRange.end;

		for (const row of getMountedRows()) {
			const rowIndex = row.rowIndex;
			const isForegroundRow =
				(rowIndex >= visibleStart && rowIndex < visibleEnd) ||
				(rowIndex >= prefetchStart && rowIndex < prefetchEnd);
			if (!isForegroundRow && !includeBackground) continue;

			for (const mountedCell of row.bindings) {
				const cell = mountedCell?.cell;
				if (!cell || cell.kind !== "item") continue;
				const logicalKey = cell.logicalKey;
				if (demandedKeys.has(logicalKey)) continue;
				demandedKeys.add(logicalKey);

				const current = modelCache.get(logicalKey);
				if (
					!refreshExisting &&
					current?.item === cell.item &&
					current.revision === revision
				) {
					continue;
				}
				const queue = isForegroundRow ? foregroundQueue : backgroundQueue;
				queue.entries.push(cell);
			}
		}
	}

	function refreshDemand(): void {
		rebuildHydrationQueues(true, options.isPreviewActive());
		scheduleDrain();
	}

	/** Evicts cache entries outside the current demand window. */
	function evictUndemandedModels(): boolean {
		let demandedModelCount = 0;
		let modelsEvicted = false;

		// Touch demanded entries so the undemanded tail is a small LRU cache.
		for (const logicalKey of demandedKeys) {
			const entry = modelCache.get(logicalKey);
			if (!entry) continue;
			modelCache.delete(logicalKey);
			modelCache.set(logicalKey, entry);
			demandedModelCount += 1;
		}

		let retainedUndemanded = modelCache.size - demandedModelCount;
		if (retainedUndemanded <= MAX_RETAINED_CARD_MODELS) return false;

		for (const logicalKey of modelCache.keys()) {
			if (demandedKeys.has(logicalKey)) continue;
			notify(logicalKey, undefined);
			modelCache.delete(logicalKey);
			modelsEvicted = true;
			retainedUndemanded -= 1;
			if (retainedUndemanded <= MAX_RETAINED_CARD_MODELS) break;
		}
		return modelsEvicted;
	}

	function syncMountedInteractions(
		mountedBuild: MountedTwoHopBuild | null,
		force = false,
	): void {
		if (disposed || (!force && mountedBuild === lastInteractionMountedBuild)) {
			return;
		}
		lastInteractionMountedBuild = mountedBuild;
		if (
			interactionController.syncMountedRows(
				mountedBuild?.rowsInMountedRange ?? EMPTY_MOUNTED_ROWS,
				resolveMountedInteractionDescriptor,
			)
		) {
			options.onInteractionHandlesChanged();
		}
	}

	function resolveMountedInteractionDescriptor(
		mountedCell: MountedTwoHopCell,
	): ItemInteractionDescriptor | null | undefined {
		if (mountedCell.cell.kind !== "item") return undefined;
		return (
			modelCache.get(mountedCell.cell.logicalKey)?.model.interactionDescriptor ??
			null
		);
	}

	function buildPreviewBindings(
		rows: readonly MountedTwoHopRow[],
		widthPx: number,
		heightPx: number,
	): VirtualPreviewBinding[] {
		const bindings: VirtualPreviewBinding[] = [];
		for (const row of rows) {
			for (const mountedCell of row.bindings) {
				if (!mountedCell || mountedCell.cell.kind !== "item") continue;
				const request = modelCache.get(mountedCell.cell.logicalKey)?.model
					.previewRequest;
				if (!request) continue;
				bindings.push({
					key: mountedCell.cell.logicalKey,
					rowIndex: mountedCell.rowIndex,
					request: applyCardPreviewDimensions(request, { widthPx, heightPx }),
				});
			}
		}
		return bindings;
	}

	function publishPreviewSnapshot(): void {
		if (disposed) return;
		const active = options.isPreviewActive();
		const dimensions = options.getCardDimensions();
		const activeChanged = active !== previewWasActive;

		if (!active) {
			previewBindings = EMPTY_PREVIEW_BINDINGS;
		} else if (
			previewBindingsDirty ||
			activeChanged ||
			lastPreviewWidthPx !== dimensions.widthPx ||
			lastPreviewHeightPx !== dimensions.heightPx
		) {
			previewBindings = buildPreviewBindings(
				getMountedRows(),
				dimensions.widthPx,
				dimensions.heightPx,
			);
			previewBindingsDirty = false;
			lastPreviewWidthPx = dimensions.widthPx;
			lastPreviewHeightPx = dimensions.heightPx;
		}
		previewWasActive = active;

		options.previewSurface.publish({
			bindings: previewBindings,
			visibleRange: previewVisibleRange,
			prefetchRange: previewPrefetchRange,
			active,
		});
	}

	function applyRangeEffects(): void {
		if (disposed) return;
		previewVisibleRange = options.getPreviewVisibleRange() ?? EMPTY_RANGE;
		const active = options.isPreviewActive();
		previewPrefetchRange = active
			? previewPrefetchRangeTracker.resolve(
					previewVisibleRange,
					options.getRowCount(),
				)
			: previewVisibleRange;

		rebuildHydrationQueues(false, active);
		if (evictUndemandedModels()) {
			syncMountedInteractions(options.getMountedBuild(), true);
			previewBindingsDirty = true;
		}
		scheduleDrain();
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
		if (mountedBuild !== lastPreviewMountedBuild) {
			lastPreviewMountedBuild = mountedBuild;
			previewBindingsDirty = true;
		}
		scheduleRangeEffects();
	}

	function scheduleDrain(): void {
		if (disposed) return;
		const priority = resolveNextPriority();
		if (!priority) {
			cancelScheduledDrain();
			return;
		}
		if (scheduledPriority === priority) return;

		cancelScheduledDrain();
		scheduledPriority = priority;
		const lane = resolveHydrationLane(priority);
		options.frameCoordinator.schedule(lane, HYDRATION_TASK_KEY, () => {
			scheduledPriority = undefined;
			if (!disposed) drain(priority);
		});
	}

	function cancelScheduledDrain(): void {
		if (scheduledPriority) {
			options.frameCoordinator.cancel(
				resolveHydrationLane(scheduledPriority),
				HYDRATION_TASK_KEY,
			);
		}
		scheduledPriority = undefined;
	}

	function drain(priority: HydrationPriority): void {
		const revision = options.getRevision();
		const previewActive = options.isPreviewActive();
		const queue = priority === "foreground" ? foregroundQueue : backgroundQueue;
		const startedAt = performance.now();
		let processed = 0;
		let previewChanged = false;
		while (
			processed < MAX_MODELS_PER_DRAIN &&
			(processed === 0 || performance.now() - startedAt < MAX_HYDRATION_CPU_MS)
		) {
			const cell = takeNext(queue);
			if (!cell) break;
			processed += 1;
			const logicalKey = cell.logicalKey;
			const current = modelCache.get(logicalKey);
			const model = options.resolveCardModel(cell.item, revision);
			const previewRenderKeyChanged =
				current?.model.previewRequest?.renderKey !==
				model.previewRequest?.renderKey;
			modelCache.set(logicalKey, { item: cell.item, revision, model });
			notify(logicalKey, model);
			if (previewActive && previewRenderKeyChanged) previewChanged = true;
		}

		const modelsEvicted = evictUndemandedModels();
		if (processed > 0 || modelsEvicted) {
			syncMountedInteractions(options.getMountedBuild(), true);
		}
		if (previewChanged || modelsEvicted) {
			previewBindingsDirty = true;
			publishPreviewSnapshot();
		}
		scheduleDrain();
	}

	function resolveNextPriority(): HydrationPriority | undefined {
		if (hasQueuedCells(foregroundQueue)) return "foreground";
		if (hasQueuedCells(backgroundQueue)) return "background";
		return undefined;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		options.frameCoordinator.cancel("post-paint", RANGE_EFFECT_TASK_KEY);
		cancelScheduledDrain();
		clearHydrationQueue(foregroundQueue);
		clearHydrationQueue(backgroundQueue);
		demandedKeys.clear();
		modelConsumers.clear();
		interactionController.clear();
		options.previewSurface.dispose();
	}

	return {
		previewSurface: options.previewSurface,
		interactionDescriptorResolverProvider: interactionController,
		getMountedRows,
		onSnapshotUpdated,
		scheduleRangeEffects,
		refreshDemand,
		registerCardModelConsumer,
		getInteractionHandle: (physicalCellSlot) =>
			interactionController.getInteractionHandle(physicalCellSlot),
		dispose,
	};
}

function createHydrationQueue(): HydrationQueue {
	return { entries: [], head: 0 };
}

function resolveHydrationLane(priority: HydrationPriority): "post-paint" | "idle" {
	return priority === "foreground" ? "post-paint" : "idle";
}

function clearHydrationQueue(queue: HydrationQueue): void {
	queue.entries.length = 0;
	queue.head = 0;
}

function hasQueuedCells(queue: HydrationQueue): boolean {
	return queue.head < queue.entries.length;
}

function takeNext(queue: HydrationQueue): TwoHopCardHydrationCell | undefined {
	const cell = queue.entries[queue.head];
	if (cell) queue.head += 1;
	return cell;
}
