import type {
	CardRenderModel,
	CardShellModel,
} from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import { resolveTwoHopCardPresentation } from "features/two-hop/ui/twoHopCellStaticState";
import type { TwoHopItemModel } from "features/two-hop/ui/twoHopSectionModel";
import {
	resolveMountedProgressiveRow,
	type TwoHopProgressiveCell,
	type TwoHopProgressivePlan,
} from "features/two-hop/ui/twoHopProgressivePlan";
import type { TwoHopRowRange } from "features/two-hop/ui/viewport/twoHopGeometry";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createVirtualCardInteractionController } from "ui/interactions/virtualCardInteractionController";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

type CardModelConsumer = (model: CardShellModel | undefined) => void;
type HydrationPriority = "foreground" | "background";
type HydrationEntry = Extract<TwoHopProgressiveCell, { kind: "item" }>;

interface HydratedCardEntry {
	readonly item: TwoHopItemModel;
	readonly revision: unknown;
	readonly model: CardRenderModel;
}

interface PendingHydration {
	readonly cell: HydrationEntry;
	priority: HydrationPriority;
}

interface HydrationQueue {
	readonly entries: HydrationEntry[];
	head: number;
}

export interface TwoHopCardDemand {
	readonly foreground: Readonly<TwoHopRowRange>;
	readonly background: Readonly<TwoHopRowRange>;
}

export interface TwoHopCardHydratorParams {
	readonly frameCoordinator: VirtualFrameCoordinator;
	readonly getPlan: () => TwoHopProgressivePlan;
	readonly getRevision: () => unknown;
	readonly getResolver: () =>
		| ((
				item: TwoHopItemModel,
				presentation: TwoHopCardPresentationState,
				revision: unknown,
		  ) => CardRenderModel)
		| undefined;
	readonly isPreviewActive: () => boolean;
	readonly onPreviewModelsChanged: () => void;
}

export interface TwoHopCardHydrator {
	readonly interactionDescriptorResolverProvider: ReturnType<
		typeof createVirtualCardInteractionController
	>["provider"];
	registerConsumer(logicalKey: string, consumer: CardModelConsumer): () => void;
	setDemand(demand: TwoHopCardDemand): void;
	refreshDemand(): void;
	getModel(logicalKey: string): CardRenderModel | undefined;
	reconcile(plan: TwoHopProgressivePlan): void;
	clear(): void;
	dispose(): void;
}

const EMPTY_RANGE = Object.freeze({ start: 0, end: 0 });
const MAX_MODELS_PER_DRAIN = 8;
const MAX_HYDRATION_CPU_MS = 1;
const MAX_RETAINED_CARD_MODELS = 64;
const HYDRATION_POST_PAINT_TASK_KEY = "two-hop-progressive-hydration-visible";
const HYDRATION_IDLE_TASK_KEY = "two-hop-progressive-hydration-preload";

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
	let demand: TwoHopCardDemand = {
		foreground: EMPTY_RANGE,
		background: EMPTY_RANGE,
	};
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

	function clear(): void {
		clearPending();
		for (const logicalKey of entries.keys()) notify(logicalKey, undefined);
		entries.clear();
		interactionController.clear();
		params.onPreviewModelsChanged();
	}

	function setDemand(nextDemand: TwoHopCardDemand): void {
		demand = {
			foreground: copyRange(nextDemand.foreground),
			background: copyRange(nextDemand.background),
		};
		reconcilePendingPriorities();
		const previewChanged = reconcileModelRetention();
		enqueueRange(demand.background, "background", false);
		enqueueRange(demand.foreground, "foreground", false);
		scheduleDrain();
		if (previewChanged) params.onPreviewModelsChanged();
	}

	function reconcileModelRetention(): boolean {
		const foregroundKeys = collectItemKeys(demand.foreground);
		const retainedKeys = collectItemKeys(demand.background, foregroundKeys);
		let retainedEntryCount = 0;
		let previewChanged = false;

		for (const logicalKey of retainedKeys) {
			const entry = entries.get(logicalKey);
			if (!entry) continue;
			entries.delete(logicalKey);
			entries.set(logicalKey, entry);
		}

		for (const logicalKey of entries.keys()) {
			if (retainedKeys.has(logicalKey)) {
				retainedEntryCount += 1;
				if (!foregroundKeys.has(logicalKey)) {
					interactionController.setCard(logicalKey, null);
				}
				continue;
			}
			interactionController.setCard(logicalKey, null);
		}

		let retainedCacheSize = entries.size - retainedEntryCount;
		if (retainedCacheSize <= MAX_RETAINED_CARD_MODELS) return false;

		for (const logicalKey of entries.keys()) {
			if (retainedKeys.has(logicalKey)) continue;
			notify(logicalKey, undefined);
			entries.delete(logicalKey);
			previewChanged = true;
			retainedCacheSize -= 1;
			if (retainedCacheSize <= MAX_RETAINED_CARD_MODELS) break;
		}

		return previewChanged;
	}

	function collectItemKeys(
		range: Readonly<TwoHopRowRange>,
		target: Set<string> = new Set(),
	): Set<string> {
		const plan = params.getPlan();
		for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
			const row = resolveMountedProgressiveRow(plan, rowIndex);
			if (!row) continue;
			for (const cell of row.cells) {
				if (cell.kind === "item") target.add(cell.logicalKey);
			}
		}
		return target;
	}

	function refreshDemand(): void {
		clearPending();
		enqueueRange(demand.background, "background", true);
		enqueueRange(demand.foreground, "foreground", true);
		scheduleDrain();
	}

	function reconcilePendingPriorities(): void {
		for (const [logicalKey, pending] of pendingByKey) {
			const nextPriority = resolveDemandPriority(pending.cell.rowIndex);
			if (!nextPriority) {
				pendingByKey.delete(logicalKey);
				continue;
			}
			if (nextPriority === pending.priority) continue;
			pending.priority = nextPriority;
			queueFor(nextPriority).entries.push(pending.cell);
		}
	}

	function resolveDemandPriority(rowIndex: number): HydrationPriority | null {
		if (isRowInRange(rowIndex, demand.foreground)) return "foreground";
		if (isRowInRange(rowIndex, demand.background)) return "background";
		return null;
	}

	function enqueueCell(
		cell: HydrationEntry,
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
				foregroundQueue.entries.push(cell);
			}
			return;
		}

		pendingByKey.set(cell.logicalKey, {
			cell,
			priority,
		});
		queueFor(priority).entries.push(cell);
	}

	function enqueueRange(
		range: Readonly<TwoHopRowRange>,
		priority: HydrationPriority,
		refreshExisting: boolean,
	): void {
		const plan = params.getPlan();
		const revision = params.getRevision();
		for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
			const row = resolveMountedProgressiveRow(plan, rowIndex);
			if (!row) continue;
			for (const cell of row.cells) {
				if (cell.kind === "item") {
					enqueueCell(cell, priority, refreshExisting, revision);
				}
			}
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
		const resolver = params.getResolver();
		if (!resolver) {
			clearPending();
			return;
		}
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
			const presentation = resolveTwoHopCardPresentation(
				hydration.item,
				hydration.section,
			);
			if (!presentation) continue;
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.resolveItemCardModel.call");
			}
			const model = resolver(hydration.item, presentation, revision);
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
	): HydrationEntry | undefined {
		while (queue.head < queue.entries.length) {
			const cell = queue.entries[queue.head];
			queue.head += 1;
			if (!cell) continue;
			const pending = pendingByKey.get(cell.logicalKey);
			if (!pending || pending.cell !== cell || pending.priority !== priority)
				continue;
			if (resolveDemandPriority(cell.rowIndex) !== priority) {
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

	function reconcile(plan: TwoHopProgressivePlan): void {
		clearPending();
		const staleKeys = new Set(entries.keys());
		for (const chunk of plan.chunks) {
			for (const row of chunk.rows) {
				for (const cell of row.cells) {
					if (cell.kind !== "item" || !staleKeys.has(cell.logicalKey))
						continue;
					if (entries.get(cell.logicalKey)?.item === cell.item) {
						staleKeys.delete(cell.logicalKey);
					}
				}
			}
		}
		for (const logicalKey of staleKeys) {
			notify(logicalKey, undefined);
			entries.delete(logicalKey);
			interactionController.setCard(logicalKey, null);
		}
		setDemand(demand);
		params.onPreviewModelsChanged();
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
		reconcile,
		clear,
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

function isRowInRange(rowIndex: number, range: Readonly<TwoHopRowRange>): boolean {
	return rowIndex >= range.start && rowIndex < range.end;
}

function copyRange(range: Readonly<TwoHopRowRange>): Readonly<TwoHopRowRange> {
	return Object.freeze({ start: range.start, end: range.end });
}
