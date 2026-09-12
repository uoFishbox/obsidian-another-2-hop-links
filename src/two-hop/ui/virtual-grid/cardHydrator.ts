import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type { TwoHopItemModel } from "two-hop/ui/twoHopSectionModel";
import type { TwoHopVirtualCell } from "./rowModel";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";

type CardModelConsumer = (model: CardRenderModel | undefined) => void;
type HydrationPriority = "foreground" | "background";

/** Item-cell payload published by the resident two-hop virtual grid. */
export type TwoHopCardHydrationCell = Extract<TwoHopVirtualCell, { kind: "item" }>;

interface HydratedCardEntry {
	readonly item: TwoHopItemModel;
	readonly revision: unknown;
	readonly model: CardRenderModel;
}

interface HydrationQueue {
	readonly entries: TwoHopCardHydrationCell[];
	head: number;
}

/**
 * Resident item cells to hydrate, split by scheduling priority.
 * Foreground wins when a logical key appears in both collections.
 * Priority controls scheduling only; interaction lifetime is owned by the grid.
 */
export interface TwoHopCardDemand {
	readonly foreground: readonly TwoHopCardHydrationCell[];
	readonly background: readonly TwoHopCardHydrationCell[];
}

/** External services required by the bounded card hydrator. */
export interface TwoHopCardHydratorParams {
	readonly frameCoordinator: VirtualFrameCoordinator;
	readonly getRevision: () => unknown;
	readonly resolveCardModel: (
		item: TwoHopItemModel,
		revision: unknown,
	) => CardRenderModel;
	readonly isPreviewActive: () => boolean;
	readonly onModelsChanged: () => void;
	readonly onPreviewModelsChanged: () => void;
}

/** Bounded asynchronous hydration and card-model cache for resident cells. */
export interface TwoHopCardHydrator {
	registerConsumer(logicalKey: string, consumer: CardModelConsumer): () => void;
	setDemand(demand: TwoHopCardDemand): void;
	refreshDemand(): void;
	getModel(logicalKey: string): CardRenderModel | undefined;
	dispose(): void;
}

const MAX_MODELS_PER_DRAIN = 8;
const MAX_HYDRATION_CPU_MS = 1;
const MAX_RETAINED_CARD_MODELS = 64;
const HYDRATION_POST_PAINT_TASK_KEY = "two-hop-virtual-hydration-visible";
const HYDRATION_IDLE_TASK_KEY = "two-hop-virtual-hydration-preload";
const EMPTY_DEMAND: TwoHopCardDemand = Object.freeze({
	foreground: Object.freeze([]),
	background: Object.freeze([]),
});

/**
 * Owns a key-addressed card cache and schedules only the latest resident demand.
 * Replacing demand rebuilds two bounded queues instead of retaining scroll history.
 */
export function createTwoHopCardHydrator(
	params: TwoHopCardHydratorParams,
): TwoHopCardHydrator {
	const modelCache = new Map<string, HydratedCardEntry>();
	const modelConsumers = new Map<string, CardModelConsumer>();
	const demandedKeys = new Set<string>();
	const foregroundQueue = createHydrationQueue();
	const backgroundQueue = createHydrationQueue();
	let demand: TwoHopCardDemand = EMPTY_DEMAND;
	let cancelDrain: (() => void) | undefined;
	let scheduledPriority: HydrationPriority | undefined;
	let disposed = false;

	function notify(logicalKey: string, model: CardRenderModel | undefined): void {
		modelConsumers.get(logicalKey)?.(model);
	}

	function registerConsumer(
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

	function setDemand(nextDemand: TwoHopCardDemand): void {
		demand = nextDemand;
		rebuildQueues(false);
		const modelsEvicted = evictUndemandedModels();
		scheduleDrain();
		if (modelsEvicted) {
			params.onModelsChanged();
			params.onPreviewModelsChanged();
		}
	}

	function refreshDemand(): void {
		rebuildQueues(true);
		scheduleDrain();
	}

	function rebuildQueues(refreshExisting: boolean): void {
		clearHydrationQueue(foregroundQueue);
		clearHydrationQueue(backgroundQueue);
		demandedKeys.clear();
		const revision = params.getRevision();

		// Foreground goes first so duplicate logical keys never enter background work.
		enqueueDemandCells(
			demand.foreground,
			foregroundQueue,
			refreshExisting,
			revision,
		);
		enqueueDemandCells(
			demand.background,
			backgroundQueue,
			refreshExisting,
			revision,
		);
	}

	function enqueueDemandCells(
		cells: readonly TwoHopCardHydrationCell[],
		queue: HydrationQueue,
		refreshExisting: boolean,
		revision: unknown,
	): void {
		for (const cell of cells) {
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
			queue.entries.push(cell);
		}
	}

	/** Evicts cache entries outside the demand window; reports if any went away. */
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

	function scheduleDrain(): void {
		if (disposed) return;
		const priority = resolveNextPriority();
		if (!priority) {
			cancelScheduledDrain();
			return;
		}
		if (cancelDrain && scheduledPriority === priority) return;

		cancelScheduledDrain();
		scheduledPriority = priority;
		const lane = priority === "foreground" ? "post-paint" : "idle";
		const taskKey =
			priority === "foreground"
				? HYDRATION_POST_PAINT_TASK_KEY
				: HYDRATION_IDLE_TASK_KEY;
		params.frameCoordinator.schedule(lane, taskKey, () => {
			cancelDrain = undefined;
			scheduledPriority = undefined;
			if (!disposed) drain(priority);
		});
		cancelDrain = () => params.frameCoordinator.cancel(lane, taskKey);
	}

	function cancelScheduledDrain(): void {
		cancelDrain?.();
		cancelDrain = undefined;
		scheduledPriority = undefined;
	}

	function drain(priority: HydrationPriority): void {
		const revision = params.getRevision();
		const previewActive = params.isPreviewActive();
		const queue = queueFor(priority);
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
			const model = params.resolveCardModel(cell.item, revision);
			const previewRenderKeyChanged =
				current?.model.previewRequest?.renderKey !==
				model.previewRequest?.renderKey;
			modelCache.set(logicalKey, {
				item: cell.item,
				revision,
				model,
			});
			notify(logicalKey, model);
			if (previewActive && previewRenderKeyChanged) previewChanged = true;
		}

		const modelsEvicted = evictUndemandedModels();
		if (processed > 0 || modelsEvicted) params.onModelsChanged();
		if (previewChanged || modelsEvicted) params.onPreviewModelsChanged();
		scheduleDrain();
	}

	function resolveNextPriority(): HydrationPriority | undefined {
		if (hasQueuedCells(foregroundQueue)) return "foreground";
		if (hasQueuedCells(backgroundQueue)) return "background";
		return undefined;
	}

	function queueFor(priority: HydrationPriority): HydrationQueue {
		return priority === "foreground" ? foregroundQueue : backgroundQueue;
	}

	function getModel(logicalKey: string): CardRenderModel | undefined {
		return modelCache.get(logicalKey)?.model;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		cancelScheduledDrain();
		clearHydrationQueue(foregroundQueue);
		clearHydrationQueue(backgroundQueue);
		demandedKeys.clear();
		modelConsumers.clear();
	}

	return {
		registerConsumer,
		setDemand,
		refreshDemand,
		getModel,
		dispose,
	};
}

function createHydrationQueue(): HydrationQueue {
	return { entries: [], head: 0 };
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
