import type {
	CardRenderModel,
	CardShellModel,
} from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import { resolveTwoHopCardPresentation } from "features/two-hop/ui/twoHopCellStaticState";
import type { TwoHopItemModel } from "features/two-hop/ui/twoHopSectionModel";
import {
	resolveMountedProgressiveRow,
	TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
	type TwoHopProgressiveCell,
	type TwoHopProgressivePlan,
} from "features/two-hop/ui/twoHopProgressivePlan";
import type { TwoHopRowRange } from "features/two-hop/ui/viewport/twoHopGeometry";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createVirtualCardInteractionController } from "ui/interactions/virtualCardInteractionController";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

type CardModelConsumer = (model: CardShellModel | undefined) => void;
type HydrationPriority = "visible" | "preload";

interface HydratedCardEntry {
	readonly item: TwoHopItemModel;
	readonly revision: unknown;
	readonly model: CardRenderModel;
}

type HydrationEntry = Extract<TwoHopProgressiveCell, { kind: "item" }>;

interface HydrationQueue {
	readonly entries: HydrationEntry[];
	readonly keys: Set<string>;
	head: number;
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
	replaceRange(range: TwoHopRowRange): void;
	refreshRanges(visible: TwoHopRowRange, resident: TwoHopRowRange): void;
	getActivatedModel(logicalKey: string): CardRenderModel | undefined;
	reconcile(plan: TwoHopProgressivePlan, visibleRange: TwoHopRowRange): void;
	clear(): void;
	dispose(): void;
}

const MAX_MODELS_PER_DRAIN = 8;
const MAX_HYDRATION_CPU_MS = 1;
const HYDRATION_POST_PAINT_TASK_KEY = "two-hop-progressive-hydration-visible";
const HYDRATION_IDLE_TASK_KEY = "two-hop-progressive-hydration-preload";

/** Owns the single logical-key card cache and its visible/preload lanes. */
export function createTwoHopCardHydrator(
	params: TwoHopCardHydratorParams,
): TwoHopCardHydrator {
	const entries = new Map<string, HydratedCardEntry>();
	const activatedKeys = new Set<string>();
	const consumers = new Map<string, CardModelConsumer>();
	const visibleQueue = createHydrationQueue();
	const preloadQueue = createHydrationQueue();
	const interactionController = createVirtualCardInteractionController();
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

	function cancelPending(): void {
		cancelDrain?.();
		cancelDrain = undefined;
		scheduledPriority = undefined;
		clearHydrationQueue(visibleQueue);
		clearHydrationQueue(preloadQueue);
		generation += 1;
	}

	function clear(): void {
		cancelPending();
		for (const logicalKey of entries.keys()) notify(logicalKey, undefined);
		entries.clear();
		activatedKeys.clear();
		interactionController.clear();
		params.onPreviewModelsChanged();
	}

	function enqueueCell(
		cell: Extract<TwoHopProgressiveCell, { kind: "item" }>,
		priority: HydrationPriority,
		refreshExisting: boolean,
	): void {
		const current = entries.get(cell.logicalKey);
		const hasCurrent =
			current?.item === cell.item && current.revision === params.getRevision();
		if (
			hasCurrent &&
			(priority === "preload" || activatedKeys.has(cell.logicalKey))
		) {
			return;
		}
		if (current && !hasCurrent && priority === "preload" && !refreshExisting) {
			return;
		}

		const queue = priority === "visible" ? visibleQueue : preloadQueue;
		if (queue.keys.has(cell.logicalKey)) return;
		if (priority === "preload" && visibleQueue.keys.has(cell.logicalKey)) return;
		queue.keys.add(cell.logicalKey);
		queue.entries.push(cell);
	}

	function enqueueRange(
		range: TwoHopRowRange,
		priority: HydrationPriority,
		refreshExisting: boolean,
	): void {
		const plan = params.getPlan();
		for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
			const row = resolveMountedProgressiveRow(plan, rowIndex);
			if (!row) continue;
			for (const cell of row.cells) {
				if (cell.kind === "item") enqueueCell(cell, priority, refreshExisting);
			}
		}
		scheduleDrain();
	}

	function enqueueChunk(chunkIndex: number): void {
		for (const row of params.getPlan().chunks[chunkIndex]?.rows ?? []) {
			for (const cell of row.cells) {
				if (cell.kind === "item") enqueueCell(cell, "preload", false);
			}
		}
		scheduleDrain();
	}

	function replaceRange(range: TwoHopRowRange): void {
		clearHydrationQueue(visibleQueue);
		clearHydrationQueue(preloadQueue);
		enqueueRange(range, "visible", false);
		if (range.end <= range.start) return;
		enqueueChunk(Math.ceil(range.end / TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK));
	}

	function refreshRanges(visible: TwoHopRowRange, resident: TwoHopRowRange): void {
		cancelPending();
		enqueueRange(visible, "visible", true);
		enqueueRange(resident, "preload", true);
	}

	function scheduleDrain(): void {
		if (disposed) return;
		const priority = hasPendingHydration(visibleQueue)
			? "visible"
			: hasPendingHydration(preloadQueue)
				? "preload"
				: undefined;
		if (!priority) return;
		if (cancelDrain && scheduledPriority === priority) return;
		cancelDrain?.();
		scheduledPriority = priority;
		const expectedGeneration = generation;
		const lane = priority === "visible" ? "post-paint" : "idle";
		const taskKey =
			priority === "visible"
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
			clearHydrationQueue(visibleQueue);
			clearHydrationQueue(preloadQueue);
			return;
		}
		const queue = priority === "visible" ? visibleQueue : preloadQueue;
		const startedAt = performance.now();
		let processed = 0;
		let previewChanged = false;
		while (
			hasPendingHydration(queue) &&
			processed < MAX_MODELS_PER_DRAIN &&
			(processed === 0 || performance.now() - startedAt < MAX_HYDRATION_CPU_MS)
		) {
			const hydration = takeNextHydrationEntry(queue);
			if (!hydration) break;
			processed += 1;
			const current = entries.get(hydration.logicalKey);
			let model = current?.model;
			let changed = false;
			let previewRenderKeyChanged = false;
			const revision = params.getRevision();
			if (current?.item !== hydration.item || current.revision !== revision) {
				const presentation = resolveTwoHopCardPresentation(
					hydration.item,
					hydration.section,
				);
				if (!presentation) continue;
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("twoHop.resolveItemCardModel.call");
				}
				model = resolver(hydration.item, presentation, revision);
				changed = current?.model !== model;
				previewRenderKeyChanged =
					current !== undefined &&
					activatedKeys.has(hydration.logicalKey) &&
					current.model.previewRequest?.renderKey !==
						model.previewRequest?.renderKey;
				entries.set(hydration.logicalKey, {
					item: hydration.item,
					revision,
					model,
				});
				notify(hydration.logicalKey, model);
			}
			if (!model) continue;

			const wasActivated = activatedKeys.has(hydration.logicalKey);
			if (priority === "visible") activatedKeys.add(hydration.logicalKey);
			if (!wasActivated && !activatedKeys.has(hydration.logicalKey)) continue;
			if (
				params.isPreviewActive() &&
				(!wasActivated
					? Boolean(model.previewRequest)
					: previewRenderKeyChanged)
			) {
				previewChanged = true;
			}
			const descriptor = model.interactionDescriptor;
			if (!wasActivated && descriptor) {
				interactionController.setCard(hydration.logicalKey, descriptor);
			} else if (wasActivated && changed) {
				interactionController.setCard(hydration.logicalKey, descriptor);
			}
		}
		compactHydrationQueue(queue);
		if (previewChanged) params.onPreviewModelsChanged();
		if (hasPendingHydration(visibleQueue) || hasPendingHydration(preloadQueue)) {
			scheduleDrain();
		}
	}

	function getActivatedModel(logicalKey: string): CardRenderModel | undefined {
		return activatedKeys.has(logicalKey)
			? entries.get(logicalKey)?.model
			: undefined;
	}

	function reconcile(
		plan: TwoHopProgressivePlan,
		visibleRange: TwoHopRowRange,
	): void {
		cancelPending();
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
			activatedKeys.delete(logicalKey);
			interactionController.setCard(logicalKey, null);
		}
		replaceRange(visibleRange);
		params.onPreviewModelsChanged();
	}

	function dispose(): void {
		disposed = true;
		cancelPending();
		consumers.clear();
		interactionController.clear();
	}

	return {
		interactionDescriptorResolverProvider: interactionController.provider,
		registerConsumer,
		replaceRange,
		refreshRanges,
		getActivatedModel,
		reconcile,
		clear,
		dispose,
	};
}

function createHydrationQueue(): HydrationQueue {
	return { entries: [], keys: new Set(), head: 0 };
}

function hasPendingHydration(queue: HydrationQueue): boolean {
	return queue.head < queue.entries.length;
}

function clearHydrationQueue(queue: HydrationQueue): void {
	queue.entries.length = 0;
	queue.keys.clear();
	queue.head = 0;
}

function takeNextHydrationEntry(queue: HydrationQueue): HydrationEntry | undefined {
	const entry = queue.entries[queue.head];
	if (!entry) return undefined;
	queue.head += 1;
	queue.keys.delete(entry.logicalKey);
	return entry;
}

function compactHydrationQueue(queue: HydrationQueue): void {
	if (queue.head === 0) return;
	const remaining = queue.entries.length - queue.head;
	if (remaining === 0) {
		queue.entries.length = 0;
		queue.head = 0;
		return;
	}
	if (queue.head < remaining) return;
	queue.entries.splice(0, queue.head);
	queue.head = 0;
}
