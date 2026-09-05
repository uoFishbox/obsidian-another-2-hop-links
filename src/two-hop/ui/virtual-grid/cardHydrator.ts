import type { CardRenderModel, CardShellModel } from "cards/rendering/cardRenderModel";
import type { TwoHopItemModel } from "two-hop/ui/twoHopSectionModel";
import type { TwoHopVirtualCell } from "./rowModel";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createVirtualCardInteractionController } from "cards/interactions/virtualCardInteractionController";

type CardModelConsumer = (model: CardShellModel | undefined) => void;
type HydrationPriority = "foreground" | "background";

/** Item-cell payload published by the resident two-hop virtual grid. */
export type TwoHopCardHydrationCell = Extract<TwoHopVirtualCell, { kind: "item" }>;

interface DemandedHydration {
	readonly cell: TwoHopCardHydrationCell;
	readonly priority: HydrationPriority;
}

interface HydratedCardEntry {
	readonly item: TwoHopItemModel;
	readonly revision: unknown;
	readonly model: CardRenderModel;
}

interface PendingHydration {
	cell: TwoHopCardHydrationCell;
	priority: HydrationPriority;
}

interface HydrationQueue {
	readonly entries: TwoHopCardHydrationCell[];
	head: number;
}

/**
 * Resident item cells to hydrate, split by scheduling priority.
 * Foreground wins when a logical key appears in both collections.
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
	readonly onPreviewModelsChanged: () => void;
}

/** Bounded asynchronous hydration and card-model cache for resident cells. */
export interface TwoHopCardHydrator {
	readonly interactionDescriptorResolverProvider: ReturnType<
		typeof createVirtualCardInteractionController
	>["provider"];
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

/** Owns a key-addressed card cache and derives work from the latest window demand. */
export function createTwoHopCardHydrator(
	params: TwoHopCardHydratorParams,
): TwoHopCardHydrator {
	const entries = new Map<string, HydratedCardEntry>();
	const consumers = new Map<string, CardModelConsumer>();
	const pendingByKey = new Map<string, PendingHydration>();
	const foregroundQueue = createHydrationQueue();
	const backgroundQueue = createHydrationQueue();
	const interactionController = createVirtualCardInteractionController();
	let demandByKey = new Map<string, DemandedHydration>();
	let cancelDrain: (() => void) | undefined;
	let scheduledPriority: HydrationPriority | undefined;
	let generation = 0;
	let disposed = false;

	function notify(logicalKey: string, model: CardShellModel | undefined): void {
		consumers.get(logicalKey)?.(model);
	}

	function registerConsumer(
		logicalKey: string,
		consumer: CardModelConsumer,
	): () => void {
		consumers.set(logicalKey, consumer);
		consumer(entries.get(logicalKey)?.model);
		return () => {
			if (consumers.get(logicalKey) === consumer) consumers.delete(logicalKey);
		};
	}

	function cancelScheduledDrain(): void {
		cancelDrain?.();
		cancelDrain = undefined;
		scheduledPriority = undefined;
		generation += 1;
	}

	function clearPending(): void {
		cancelScheduledDrain();
		pendingByKey.clear();
		clearHydrationQueue(foregroundQueue);
		clearHydrationQueue(backgroundQueue);
	}

	function setDemand(nextDemand: TwoHopCardDemand): void {
		demandByKey = indexDemand(nextDemand);
		reconcilePendingPriorities();
		const previewChanged = reconcileModelRetention();
		enqueueDemand(false);
		scheduleDrain();
		if (previewChanged) params.onPreviewModelsChanged();
	}

	function reconcileModelRetention(): boolean {
		let retainedEntryCount = 0;
		let previewChanged = false;

		for (const logicalKey of demandByKey.keys()) {
			const entry = entries.get(logicalKey);
			if (!entry) continue;
			entries.delete(logicalKey);
			entries.set(logicalKey, entry);
		}

		for (const logicalKey of entries.keys()) {
			const demanded = demandByKey.get(logicalKey);
			if (demanded) {
				retainedEntryCount += 1;
				if (demanded.priority !== "foreground") {
					interactionController.setCard(logicalKey, null);
				}
				continue;
			}
			interactionController.setCard(logicalKey, null);
		}

		let retainedCacheSize = entries.size - retainedEntryCount;
		if (retainedCacheSize <= MAX_RETAINED_CARD_MODELS) return false;

		for (const logicalKey of entries.keys()) {
			if (demandByKey.has(logicalKey)) continue;
			notify(logicalKey, undefined);
			entries.delete(logicalKey);
			previewChanged = true;
			retainedCacheSize -= 1;
			if (retainedCacheSize <= MAX_RETAINED_CARD_MODELS) break;
		}

		return previewChanged;
	}

	function refreshDemand(): void {
		clearPending();
		enqueueDemand(true);
		scheduleDrain();
	}

	function reconcilePendingPriorities(): void {
		for (const [logicalKey, pending] of pendingByKey) {
			const demanded = demandByKey.get(logicalKey);
			if (!demanded) {
				pendingByKey.delete(logicalKey);
				continue;
			}
			if (
				demanded.priority === pending.priority &&
				demanded.cell === pending.cell
			) {
				continue;
			}
			pending.cell = demanded.cell;
			pending.priority = demanded.priority;
		}
	}

	function enqueueCell(
		cell: TwoHopCardHydrationCell,
		priority: HydrationPriority,
		refreshExisting: boolean,
		revision: unknown,
	): void {
		const current = entries.get(cell.logicalKey);
		const hasCurrent = current?.item === cell.item && current.revision === revision;
		if (hasCurrent && !refreshExisting) {
			if (priority === "foreground" && current) {
				interactionController.setCard(
					cell.logicalKey,
					current.model.interactionDescriptor,
				);
			}
			return;
		}

		const existing = pendingByKey.get(cell.logicalKey);
		if (existing) {
			if (priority === "foreground" && existing.priority !== "foreground") {
				existing.priority = "foreground";
			}
			return;
		}

		pendingByKey.set(cell.logicalKey, {
			cell,
			priority,
		});
	}

	function enqueueDemand(refreshExisting: boolean): void {
		const revision = params.getRevision();
		for (const demanded of demandByKey.values()) {
			enqueueCell(demanded.cell, demanded.priority, refreshExisting, revision);
		}
		// Idle work may never drain. Rebuild in reused storage so cancelled cells
		// and obsolete priority entries cannot accumulate across scroll windows.
		clearHydrationQueue(foregroundQueue);
		clearHydrationQueue(backgroundQueue);
		for (const pending of pendingByKey.values()) {
			queueFor(pending.priority).entries.push(pending.cell);
		}
	}

	function scheduleDrain(): void {
		if (disposed) return;
		const priority = hasPendingPriority("foreground")
			? "foreground"
			: hasPendingPriority("background")
				? "background"
				: undefined;
		if (!priority) {
			if (cancelDrain) cancelScheduledDrain();
			return;
		}
		if (cancelDrain && scheduledPriority === priority) return;
		cancelDrain?.();
		scheduledPriority = priority;
		const expectedGeneration = generation;
		const lane = priority === "foreground" ? "post-paint" : "idle";
		const taskKey =
			priority === "foreground"
				? HYDRATION_POST_PAINT_TASK_KEY
				: HYDRATION_IDLE_TASK_KEY;
		params.frameCoordinator.schedule(lane, taskKey, () => {
			cancelDrain = undefined;
			scheduledPriority = undefined;
			if (disposed || expectedGeneration !== generation) return;
			drain(priority);
		});
		cancelDrain = () => params.frameCoordinator.cancel(lane, taskKey);
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
			const hydration = takeNextPending(queue, priority);
			if (!hydration) break;
			processed += 1;
			const current = entries.get(hydration.logicalKey);
			const model = params.resolveCardModel(hydration.item, revision);
			const previewRenderKeyChanged =
				previewActive &&
				(priority === "foreground" || current !== undefined) &&
				current?.model.previewRequest?.renderKey !==
					model.previewRequest?.renderKey;
			entries.set(hydration.logicalKey, {
				item: hydration.item,
				revision,
				model,
			});
			notify(hydration.logicalKey, model);
			if (priority === "foreground") {
				interactionController.setCard(
					hydration.logicalKey,
					model.interactionDescriptor,
				);
			}
			if (previewActive && previewRenderKeyChanged) previewChanged = true;
		}
		compactHydrationQueue(queue);
		const retainedModelsEvicted = reconcileModelRetention();
		if (previewChanged || retainedModelsEvicted) {
			params.onPreviewModelsChanged();
		}
		if (hasPendingPriority("foreground") || hasPendingPriority("background")) {
			scheduleDrain();
		}
	}

	function takeNextPending(
		queue: HydrationQueue,
		priority: HydrationPriority,
	): TwoHopCardHydrationCell | undefined {
		while (queue.head < queue.entries.length) {
			const cell = queue.entries[queue.head];
			queue.head += 1;
			if (!cell) continue;
			const pending = pendingByKey.get(cell.logicalKey);
			if (!pending || pending.priority !== priority || pending.cell !== cell) {
				continue;
			}
			const demanded = demandByKey.get(cell.logicalKey);
			if (!demanded || demanded.priority !== priority || demanded.cell !== cell) {
				pendingByKey.delete(cell.logicalKey);
				continue;
			}
			pendingByKey.delete(cell.logicalKey);
			return cell;
		}
		return undefined;
	}

	function hasPendingPriority(priority: HydrationPriority): boolean {
		for (const pending of pendingByKey.values()) {
			if (pending.priority === priority) return true;
		}
		return false;
	}

	function getModel(logicalKey: string): CardRenderModel | undefined {
		return entries.get(logicalKey)?.model;
	}

	function dispose(): void {
		disposed = true;
		clearPending();
		consumers.clear();
		interactionController.clear();
	}

	function queueFor(priority: HydrationPriority): HydrationQueue {
		return priority === "foreground" ? foregroundQueue : backgroundQueue;
	}

	return {
		interactionDescriptorResolverProvider: interactionController.provider,
		registerConsumer,
		setDemand,
		refreshDemand,
		getModel,
		dispose,
	};
}

function indexDemand(demand: TwoHopCardDemand): Map<string, DemandedHydration> {
	const demandByKey = new Map<string, DemandedHydration>();
	for (const cell of demand.background) {
		demandByKey.set(cell.logicalKey, { cell, priority: "background" });
	}
	for (const cell of demand.foreground) {
		demandByKey.set(cell.logicalKey, { cell, priority: "foreground" });
	}
	return demandByKey;
}

function createHydrationQueue(): HydrationQueue {
	return { entries: [], head: 0 };
}

function clearHydrationQueue(queue: HydrationQueue): void {
	queue.entries.length = 0;
	queue.head = 0;
}

function compactHydrationQueue(queue: HydrationQueue): void {
	if (queue.head === 0) return;
	const remaining = queue.entries.length - queue.head;
	if (remaining === 0) {
		clearHydrationQueue(queue);
		return;
	}
	if (queue.head < remaining) return;
	queue.entries.splice(0, queue.head);
	queue.head = 0;
}
