import { onDestroy, tick, untrack } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import { resolveTwoHopCardPresentation } from "features/two-hop/ui/twoHopCellStaticState";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createTwoHopDocumentProjection,
	type TwoHopDocument,
} from "features/two-hop/ui/twoHopDocument";
import {
	compileFixedGridLayout,
	type TwoHopRowRange,
	type TwoHopGeometry,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	appendTwoHopProgressivePlan,
	compileTwoHopProgressivePlan,
	resolveInitialProgressiveMountedRowEnd,
	resolveNextProgressiveMountedRowEnd,
	TWO_HOP_PROGRESSIVE_PRELOAD_CHUNK_COUNT,
	TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
	type TwoHopProgressiveCell,
	type TwoHopProgressivePlan,
	type TwoHopProgressiveRow,
} from "features/two-hop/ui/twoHopProgressivePlan";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import { DISABLED_PREVIEW_SURFACE } from "features/preview/runtime/previewRuntime";
import type {
	PreviewFrame,
	RowPreviewCardBinding,
	VirtualPreviewSurface,
} from "features/preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createVirtualCardInteractionController } from "ui/interactions/virtualCardInteractionController";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { resolveCachedCardGridLayoutBase } from "ui/virtualization/dom/virtualListCardLayout";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "ui/virtualization/scheduling/scrollActivity";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { resolveProgressivePreviewRangeInto } from "features/two-hop/ui/progressivePreviewRange";

export interface TwoHopProgressiveListProps {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationScope?: string;
	readonly previewActive?: boolean;
	readonly resolveItemCardModel?: (
		item: TwoHopVirtualListItem,
		presentation: TwoHopCardPresentationState,
	) => CardRenderModel;
}

interface HydrationEntry {
	readonly logicalKey: string;
	readonly cell: Extract<TwoHopProgressiveCell, { kind: "item" }>;
}

interface HydrationQueue {
	readonly entries: HydrationEntry[];
	readonly keys: Set<string>;
	head: number;
}

interface LayoutAnchor {
	readonly logicalKey: string;
	readonly viewportOffset: number;
}

type CardModelConsumer = (model: CardRenderModel | undefined) => void;
type HydrationPriority = "visible" | "preload";

const MAX_MODELS_PER_DRAIN = 8;
const MAX_HYDRATION_CPU_MS = 1;
const HYDRATION_POST_PAINT_TASK_KEY = "two-hop-progressive-hydration-visible";
const HYDRATION_IDLE_TASK_KEY = "two-hop-progressive-hydration-preload";
const EMPTY_PREVIEW_RANGE = Object.freeze({ start: 0, end: 0 });
const PREVIEW_SCROLL_TASK_KEY = "two-hop-progressive-preview-window";
const PREVIEW_SCROLL_IDLE_MS = 140;

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

export function resolveProgressivePreviewSlotId(logicalKey: string): string {
	return `two-hop-progressive:${logicalKey}`;
}

function resolveMountedProgressiveRow(
	plan: TwoHopProgressivePlan,
	rowIndex: number,
): TwoHopProgressiveRow | null {
	if (rowIndex < 0 || rowIndex >= plan.mountedRowEnd) return null;
	const chunkIndex = Math.floor(rowIndex / TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK);
	const chunk = plan.chunks[chunkIndex];
	if (!chunk) return null;
	const row = chunk.rows[rowIndex - chunk.rowStart];
	return row?.rowIndex === rowIndex ? row : null;
}

/** Owns append-only chunk publication, lazy model hydration, and bounded preview state. */
export function useTwoHopProgressiveList(
	props: TwoHopProgressiveListProps,
	frameCoordinator: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	const documentProjection = createTwoHopDocumentProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
		paginationScope: props.paginationScope,
	});
	const initialDocument = documentProjection.getDocument();
	const initialGeometry = compileFixedGridLayout(
		initialDocument,
		DEFAULT_VIEW_PLAN_LAYOUT,
	);
	const initialMountedRowEnd = resolveInitialProgressiveMountedRowEnd(
		initialGeometry.rowCount,
	);
	let document = $state.raw<TwoHopDocument>(initialDocument);
	let layout = $state.raw<ViewPlanLayoutMetrics>(DEFAULT_VIEW_PLAN_LAYOUT);
	let geometry = $state.raw<TwoHopGeometry>(initialGeometry);
	let plan = $state.raw<TwoHopProgressivePlan>(
		compileTwoHopProgressivePlan(
			initialDocument,
			initialGeometry,
			initialMountedRowEnd,
		),
	);
	let rootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let sentinelEl = $state<HTMLDivElement | null>(null);
	let disposed = false;

	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(applicationStore.settings),
	);
	const previewSurface: VirtualPreviewSurface = props.previewDependencies
		? props.previewDependencies.previewRuntime.createSurface({
				frameCoordinator,
				resolveSearchMatchPosition:
					props.previewDependencies.resolveSearchMatchPosition,
			})
		: DISABLED_PREVIEW_SURFACE;
	const interactionController = createVirtualCardInteractionController();
	const modelsByLogicalKey = new Map<string, CardRenderModel>();
	const modelConsumersByLogicalKey = new Map<string, Set<CardModelConsumer>>();
	const previewBindingByLogicalKey = new Map<string, RowPreviewCardBinding>();
	const visibleHydrationQueue = createHydrationQueue();
	const preloadHydrationQueue = createHydrationQueue();
	const observedChunks = new Map<Element, number>();
	const previewRowConsumers = new Map<number, (active: boolean) => void>();
	const activePreviewRange: TwoHopRowRange = { start: 0, end: 0 };
	const nextPreviewRange: TwoHopRowRange = { start: 0, end: 0 };
	let hydrationObserver: IntersectionObserver | undefined;
	let sentinelObserver: IntersectionObserver | undefined;
	let cancelHydrationDrain: (() => void) | undefined;
	let scheduledHydrationPriority: HydrationPriority | undefined;
	let previewRangeAnimationFrame: number | undefined;
	let previewScrollIdleTimer: number | undefined;
	let previewScrollContainer: HTMLElement | null = null;
	let previewOwnerWindow: Window | null = null;
	let contentTopInScrollSpace = 0;
	let previewViewportHeight = 0;
	let hydrationGeneration = 0;
	let previewPublicationScheduled = false;
	let lastInputDocumentRevision = initialDocument.revision;

	function notifyModelConsumers(
		logicalKey: string,
		model: CardRenderModel | undefined,
	): void {
		for (const consumer of modelConsumersByLogicalKey.get(logicalKey) ?? []) {
			consumer(model);
		}
	}

	function registerCardModelConsumer(
		logicalKey: string,
		consumer: CardModelConsumer,
	): () => void {
		let consumers = modelConsumersByLogicalKey.get(logicalKey);
		if (!consumers) {
			consumers = new Set();
			modelConsumersByLogicalKey.set(logicalKey, consumers);
		}
		consumers.add(consumer);
		consumer(modelsByLogicalKey.get(logicalKey));
		return () => {
			consumers?.delete(consumer);
			if (consumers?.size === 0) {
				modelConsumersByLogicalKey.delete(logicalKey);
			}
		};
	}

	function cancelPendingHydration(): void {
		cancelHydrationDrain?.();
		cancelHydrationDrain = undefined;
		scheduledHydrationPriority = undefined;
		clearHydrationQueue(visibleHydrationQueue);
		clearHydrationQueue(preloadHydrationQueue);
		hydrationGeneration += 1;
	}

	function clearHydratedModels(): void {
		cancelPendingHydration();
		for (const logicalKey of modelsByLogicalKey.keys()) {
			notifyModelConsumers(logicalKey, undefined);
		}
		modelsByLogicalKey.clear();
		previewBindingByLogicalKey.clear();
		interactionController.clear();
		enqueueHydrationForRowRange(activePreviewRange);
		schedulePreviewPublication();
	}

	function enqueueHydrationCell(
		cell: Extract<TwoHopProgressiveCell, { kind: "item" }>,
		priority: HydrationPriority,
	): void {
		if (modelsByLogicalKey.has(cell.logicalKey)) return;
		const queue =
			priority === "visible" ? visibleHydrationQueue : preloadHydrationQueue;
		if (queue.keys.has(cell.logicalKey)) return;
		if (priority === "preload" && visibleHydrationQueue.keys.has(cell.logicalKey)) {
			return;
		}
		queue.keys.add(cell.logicalKey);
		queue.entries.push({ logicalKey: cell.logicalKey, cell });
	}

	function enqueueHydrationForChunk(chunkIndex: number): void {
		const activePlan = untrack(() => plan);
		const startIndex = Math.max(
			0,
			chunkIndex - TWO_HOP_PROGRESSIVE_PRELOAD_CHUNK_COUNT,
		);
		const endIndex = Math.min(
			activePlan.chunks.length - 1,
			chunkIndex + TWO_HOP_PROGRESSIVE_PRELOAD_CHUNK_COUNT,
		);
		for (let index = startIndex; index <= endIndex; index += 1) {
			for (const row of activePlan.chunks[index]?.rows ?? []) {
				for (const cell of row.cells) {
					if (cell.kind === "item") enqueueHydrationCell(cell, "preload");
				}
			}
		}
		scheduleHydrationDrain();
	}

	function enqueueHydrationForRowRange(range: TwoHopRowRange): void {
		const activePlan = untrack(() => plan);
		for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
			const row = resolveMountedProgressiveRow(activePlan, rowIndex);
			if (!row) continue;
			for (const cell of row.cells) {
				if (cell.kind === "item") enqueueHydrationCell(cell, "visible");
			}
		}
		scheduleHydrationDrain();
	}

	function scheduleHydrationDrain(): void {
		if (disposed) return;
		const priority: HydrationPriority | undefined = hasPendingHydration(
			visibleHydrationQueue,
		)
			? "visible"
			: hasPendingHydration(preloadHydrationQueue)
				? "preload"
				: undefined;
		if (!priority) return;
		if (cancelHydrationDrain && scheduledHydrationPriority === priority) return;
		cancelHydrationDrain?.();
		cancelHydrationDrain = undefined;
		scheduledHydrationPriority = priority;
		const expectedGeneration = hydrationGeneration;
		const run = (): void => {
			cancelHydrationDrain = undefined;
			scheduledHydrationPriority = undefined;
			if (disposed || expectedGeneration !== hydrationGeneration) return;
			drainHydrationQueue(priority);
		};
		const lane = priority === "visible" ? "post-paint" : "idle";
		const taskKey =
			priority === "visible"
				? HYDRATION_POST_PAINT_TASK_KEY
				: HYDRATION_IDLE_TASK_KEY;
		frameCoordinator.schedule(lane, taskKey, run);
		cancelHydrationDrain = () => frameCoordinator.cancel(lane, taskKey);
	}

	function drainHydrationQueue(priority: HydrationPriority): void {
		const resolver = untrack(() => props.resolveItemCardModel);
		if (!resolver) {
			clearHydrationQueue(visibleHydrationQueue);
			clearHydrationQueue(preloadHydrationQueue);
			return;
		}
		const queue =
			priority === "visible" ? visibleHydrationQueue : preloadHydrationQueue;
		const startedAt = performance.now();
		let processedCount = 0;
		let activePreviewHydrationChanged = false;
		while (
			hasPendingHydration(queue) &&
			processedCount < MAX_MODELS_PER_DRAIN &&
			(processedCount === 0 ||
				performance.now() - startedAt < MAX_HYDRATION_CPU_MS)
		) {
			const entry = takeNextHydrationEntry(queue);
			if (!entry) break;
			processedCount += 1;
			if (modelsByLogicalKey.has(entry.logicalKey)) continue;
			const presentation = resolveTwoHopCardPresentation(
				entry.cell.item,
				entry.cell.section.header.section,
			);
			if (!presentation) continue;
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.resolveItemCardModel.call");
			}
			const model = resolver(entry.cell.item, presentation);
			modelsByLogicalKey.set(entry.logicalKey, model);
			notifyModelConsumers(entry.logicalKey, model);
			if (
				model.previewRequest &&
				entry.cell.rowIndex >= activePreviewRange.start &&
				entry.cell.rowIndex < activePreviewRange.end
			) {
				activePreviewHydrationChanged = true;
			}
			if (model.interactionDescriptor) {
				interactionController.syncCardDelta({
					enteredSlots: [
						{
							slotId: entry.logicalKey,
							descriptor: model.interactionDescriptor,
						},
					],
					reboundSlots: [],
					releasedSlots: [],
				});
			}
		}
		compactHydrationQueue(queue);
		if (
			activePreviewHydrationChanged &&
			props.previewDependencies !== undefined &&
			props.previewActive !== false
		) {
			schedulePreviewPublication();
		}
		if (
			hasPendingHydration(visibleHydrationQueue) ||
			hasPendingHydration(preloadHydrationQueue)
		) {
			scheduleHydrationDrain();
		}
	}

	function flushScheduledPreviewPublication(): void {
		previewPublicationScheduled = false;
		if (disposed) return;
		publishPreviewFrame();
	}

	function schedulePreviewPublication(): void {
		if (disposed || previewPublicationScheduled) return;
		previewPublicationScheduled = true;
		queueMicrotask(flushScheduledPreviewPublication);
	}

	function publishPreviewFrame(): void {
		const active =
			props.previewDependencies !== undefined && props.previewActive !== false;
		const bindings = new Map<string, RowPreviewCardBinding>();
		let rangeStart = Number.POSITIVE_INFINITY;
		let rangeEnd = 0;

		if (active) {
			const activePlan = untrack(() => plan);
			rangeStart = activePreviewRange.start;
			rangeEnd = activePreviewRange.end;
			for (
				let rowIndex = activePreviewRange.start;
				rowIndex < activePreviewRange.end;
				rowIndex += 1
			) {
				const row = resolveMountedProgressiveRow(activePlan, rowIndex);
				if (!row) continue;
				for (const cell of row.cells) {
					if (cell.kind !== "item") continue;
					const model = modelsByLogicalKey.get(cell.logicalKey);
					if (!model?.previewRequest) continue;
					const previousBinding = previewBindingByLogicalKey.get(
						cell.logicalKey,
					);
					const slotId =
						previousBinding?.slotId ??
						resolveProgressivePreviewSlotId(cell.logicalKey);
					const binding =
						previousBinding?.rowIndex === rowIndex &&
						previousBinding.ownerToken === cell &&
						previousBinding.request.renderKey ===
							model.previewRequest.renderKey
							? previousBinding
							: Object.freeze({
									slotId,
									rowIndex,
									request: model.previewRequest,
									ownerToken: cell,
								});
					previewBindingByLogicalKey.set(cell.logicalKey, binding);
					bindings.set(slotId, binding);
				}
			}
		}
		for (const [logicalKey, binding] of previewBindingByLogicalKey) {
			if (bindings.has(binding.slotId)) continue;
			previewBindingByLogicalKey.delete(logicalKey);
		}

		const previewRange = Number.isFinite(rangeStart)
			? Object.freeze({ start: rangeStart, end: rangeEnd })
			: EMPTY_PREVIEW_RANGE;
		const frame: PreviewFrame = Object.freeze({
			previewBindingsBySlot: bindings,
			previewWindow: Object.freeze({ previewRange, active }),
		});
		previewSurface.publish(frame);
	}

	function registerPreviewRow(
		rowIndex: number,
		setPreviewCandidate: (active: boolean) => void,
	): () => void {
		previewRowConsumers.set(rowIndex, setPreviewCandidate);
		setPreviewCandidate(
			rowIndex >= activePreviewRange.start && rowIndex < activePreviewRange.end,
		);
		return () => {
			if (previewRowConsumers.get(rowIndex) === setPreviewCandidate) {
				previewRowConsumers.delete(rowIndex);
			}
			setPreviewCandidate(false);
		};
	}

	function publishPreviewRange(next: TwoHopRowRange): void {
		const previousStart = activePreviewRange.start;
		const previousEnd = activePreviewRange.end;
		if (previousStart === next.start && previousEnd === next.end) return;
		enqueueHydrationForRowRange(next);

		for (let rowIndex = previousStart; rowIndex < previousEnd; rowIndex += 1) {
			if (rowIndex >= next.start && rowIndex < next.end) continue;
			previewRowConsumers.get(rowIndex)?.(false);
		}
		for (let rowIndex = next.start; rowIndex < next.end; rowIndex += 1) {
			if (rowIndex >= previousStart && rowIndex < previousEnd) continue;
			previewRowConsumers.get(rowIndex)?.(true);
		}

		activePreviewRange.start = next.start;
		activePreviewRange.end = next.end;
		schedulePreviewPublication();
	}

	function readPreviewScrollTop(): number {
		return previewScrollContainer?.scrollTop ?? previewOwnerWindow?.scrollY ?? 0;
	}

	function measurePreviewViewportGeometry(): void {
		if (!contentEl || !previewOwnerWindow) return;
		const contentRect = contentEl.getBoundingClientRect();
		if (previewScrollContainer) {
			const scrollerRect = previewScrollContainer.getBoundingClientRect();
			contentTopInScrollSpace =
				contentRect.top - scrollerRect.top + previewScrollContainer.scrollTop;
			previewViewportHeight = previewScrollContainer.clientHeight;
			return;
		}
		contentTopInScrollSpace = contentRect.top + previewOwnerWindow.scrollY;
		previewViewportHeight = previewOwnerWindow.innerHeight;
	}

	function flushPreviewRangeFromScroll(): void {
		previewRangeAnimationFrame = undefined;
		if (disposed) return;
		const activeGeometry = untrack(() => geometry);
		const mountedRowEnd = untrack(() => plan.mountedRowEnd);
		resolveProgressivePreviewRangeInto(
			nextPreviewRange,
			activeGeometry,
			readPreviewScrollTop() - contentTopInScrollSpace,
			previewViewportHeight,
			mountedRowEnd,
		);
		publishPreviewRange(nextPreviewRange);
	}

	function schedulePreviewRangeUpdate(): void {
		if (disposed) return;
		if (frameCoordinator) {
			frameCoordinator.schedule(
				"scroll-critical",
				PREVIEW_SCROLL_TASK_KEY,
				flushPreviewRangeFromScroll,
			);
			return;
		}
		if (previewRangeAnimationFrame !== undefined || !previewOwnerWindow) return;
		previewRangeAnimationFrame = previewOwnerWindow.requestAnimationFrame(
			flushPreviewRangeFromScroll,
		);
	}

	function schedulePreviewScrollIdle(): void {
		if (!previewOwnerWindow) return;
		if (previewScrollIdleTimer !== undefined) {
			previewOwnerWindow.clearTimeout(previewScrollIdleTimer);
		}
		previewScrollIdleTimer = previewOwnerWindow.setTimeout(() => {
			previewScrollIdleTimer = undefined;
			markScrollActivityIdle(previewScrollActivitySource);
		}, PREVIEW_SCROLL_IDLE_MS);
	}

	const previewScrollActivitySource = {};
	function handlePreviewScroll(): void {
		markScrollActivityActive(previewScrollActivitySource);
		schedulePreviewRangeUpdate();
		schedulePreviewScrollIdle();
	}

	function observeHydrationChunk(
		element: HTMLElement,
		chunkIndex: number,
	): () => void {
		observedChunks.set(element, chunkIndex);
		hydrationObserver?.observe(element);
		return () => {
			hydrationObserver?.unobserve(element);
			observedChunks.delete(element);
		};
	}

	function rebuildIntersectionObservers(): void {
		hydrationObserver?.disconnect();
		sentinelObserver?.disconnect();
		hydrationObserver = undefined;
		sentinelObserver = undefined;
		if (!rootEl || typeof IntersectionObserver === "undefined") {
			for (const chunkIndex of observedChunks.values()) {
				enqueueHydrationForChunk(chunkIndex);
			}
			return;
		}

		const observerRoot = findNearestScrollContainer(rootEl);
		const chunkPreloadDistancePx =
			geometry.rowStride * TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK;
		hydrationObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const chunkIndex = observedChunks.get(entry.target);
					if (chunkIndex !== undefined) enqueueHydrationForChunk(chunkIndex);
				}
			},
			{
				root: observerRoot,
				rootMargin: `${chunkPreloadDistancePx}px 0px ${chunkPreloadDistancePx}px 0px`,
			},
		);
		sentinelObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadNextChunk();
			},
			{
				root: observerRoot,
				rootMargin: `0px 0px ${chunkPreloadDistancePx}px 0px`,
			},
		);
		for (const element of observedChunks.keys()) {
			hydrationObserver.observe(element);
		}
		if (sentinelEl) sentinelObserver.observe(sentinelEl);
	}

	function loadNextChunk(): void {
		const currentMountedRowEnd = plan.mountedRowEnd;
		const nextEnd = resolveNextProgressiveMountedRowEnd(
			currentMountedRowEnd,
			geometry.rowCount,
		);
		if (nextEnd === currentMountedRowEnd) return;
		plan = appendTwoHopProgressivePlan(document, geometry, plan, nextEnd);
	}

	function captureLayoutAnchor(): LayoutAnchor | null {
		if (!rootEl?.shadowRoot) return null;
		const scrollRoot = findNearestScrollContainer(rootEl);
		const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
		for (const element of rootEl.shadowRoot.querySelectorAll<HTMLElement>(
			"[data-ccl-logical-key]",
		)) {
			const rect = element.getBoundingClientRect();
			if (rect.bottom <= viewportTop) continue;
			return {
				logicalKey: element.dataset.cclLogicalKey ?? "",
				viewportOffset: rect.top - viewportTop,
			};
		}
		return null;
	}

	async function restoreLayoutAnchor(anchor: LayoutAnchor | null): Promise<void> {
		if (!anchor?.logicalKey || !rootEl?.shadowRoot) return;
		await tick();
		const escapedKey = CSS.escape(anchor.logicalKey);
		const element = rootEl.shadowRoot.querySelector<HTMLElement>(
			`[data-ccl-logical-key="${escapedKey}"]`,
		);
		if (!element) return;
		const scrollRoot = findNearestScrollContainer(rootEl);
		const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
		const delta =
			element.getBoundingClientRect().top - viewportTop - anchor.viewportOffset;
		if (Math.abs(delta) < 0.5) return;
		if (scrollRoot) scrollRoot.scrollTop += delta;
		else window.scrollBy({ top: delta });
	}

	function measureLayout(): void {
		if (!rootEl) return;
		const rect = rootEl.getBoundingClientRect();
		const layoutBase = resolveCachedCardGridLayoutBase({
			rootEl,
			rootRect: rect,
			measuredWidth: rect.width > 0 ? rect.width : null,
			defaults: DEFAULT_VIEW_PLAN_CARD_LAYOUT,
			listKind: "view-plan",
			scrollContainerEl: findNearestScrollContainer(rootEl),
			configuredLayout,
		});
		const nextLayout: ViewPlanLayoutMetrics = {
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
		if (isSameViewPlanLayout(layout, nextLayout)) return;
		const anchor = captureLayoutAnchor();
		const nextGeometry = compileFixedGridLayout(document, nextLayout);
		const nextMountedRowEnd = Math.min(plan.mountedRowEnd, nextGeometry.rowCount);
		layout = nextLayout;
		geometry = nextGeometry;
		plan = compileTwoHopProgressivePlan(document, nextGeometry, nextMountedRowEnd);
		void restoreLayoutAnchor(anchor);
	}

	function publishDocument(
		nextDocument: TwoHopDocument,
		resetMountedPrefix: boolean,
	): void {
		if (nextDocument === document) return;
		const nextGeometry = compileFixedGridLayout(nextDocument, layout);
		const nextMountedRowEnd = resetMountedPrefix
			? resolveInitialProgressiveMountedRowEnd(nextGeometry.rowCount)
			: Math.min(
					nextGeometry.rowCount,
					Math.max(
						plan.mountedRowEnd,
						resolveInitialProgressiveMountedRowEnd(nextGeometry.rowCount),
					),
				);
		document = nextDocument;
		geometry = nextGeometry;
		plan = compileTwoHopProgressivePlan(
			nextDocument,
			nextGeometry,
			nextMountedRowEnd,
		);
		if (resetMountedPrefix) clearHydratedModels();
	}

	$effect(() => {
		const nextDocument = documentProjection.setInput({
			sections: props.sections,
			paginationScope: props.paginationScope ?? "",
			initialVisibleCount: props.initialVisibleCount,
			loadMoreIncrement: props.loadMoreIncrement,
		});
		if (nextDocument.revision !== lastInputDocumentRevision) {
			lastInputDocumentRevision = nextDocument.revision;
			publishDocument(nextDocument, true);
		}
	});

	let previousResolver = props.resolveItemCardModel;
	$effect(() => {
		const resolver = props.resolveItemCardModel;
		if (resolver === previousResolver) return;
		previousResolver = resolver;
		clearHydratedModels();
	});

	$effect(() => {
		const activePlan = plan;
		if (activePlan.chunks.length === 0) return;
		enqueueHydrationForChunk(0);
	});

	$effect(() => {
		const element = rootEl;
		const content = contentEl;
		void configuredLayout;
		if (!element || !content) return;
		previewScrollContainer = findNearestScrollContainer(element);
		previewOwnerWindow = element.ownerDocument.defaultView;
		measureLayout();
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			measureLayout();
			measurePreviewViewportGeometry();
			flushPreviewRangeFromScroll();
		});
		observer.observe(element);
		observer.observe(content);
		if (previewScrollContainer) observer.observe(previewScrollContainer);
		return () => observer.disconnect();
	});

	$effect(() => {
		const element = rootEl;
		const content = contentEl;
		if (!element || !content) return;
		const ownerWindow = element.ownerDocument.defaultView;
		if (!ownerWindow) return;
		const scrollContainer = findNearestScrollContainer(element);
		const scrollTarget: HTMLElement | Window = scrollContainer ?? ownerWindow;
		previewScrollContainer = scrollContainer;
		previewOwnerWindow = ownerWindow;
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
		scrollTarget.addEventListener("scroll", handlePreviewScroll, { passive: true });
		return () => {
			scrollTarget.removeEventListener("scroll", handlePreviewScroll);
			if (previewScrollIdleTimer !== undefined) {
				ownerWindow.clearTimeout(previewScrollIdleTimer);
				previewScrollIdleTimer = undefined;
			}
			markScrollActivityIdle(previewScrollActivitySource);
		};
	});

	$effect(() => {
		void geometry;
		void plan.mountedRowEnd;
		if (!contentEl) return;
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
	});

	$effect(() => {
		void rootEl;
		void contentEl;
		void sentinelEl;
		void geometry.rowStride;
		rebuildIntersectionObservers();
		return () => {
			hydrationObserver?.disconnect();
			sentinelObserver?.disconnect();
		};
	});

	$effect(() => {
		void props.previewActive;
		schedulePreviewPublication();
	});

	onDestroy(() => {
		disposed = true;
		cancelPendingHydration();
		hydrationObserver?.disconnect();
		sentinelObserver?.disconnect();
		frameCoordinator.cancel("scroll-critical", PREVIEW_SCROLL_TASK_KEY);
		if (previewRangeAnimationFrame !== undefined && previewOwnerWindow) {
			previewOwnerWindow.cancelAnimationFrame(previewRangeAnimationFrame);
		}
		if (previewScrollIdleTimer !== undefined && previewOwnerWindow) {
			previewOwnerWindow.clearTimeout(previewScrollIdleTimer);
		}
		markScrollActivityIdle(previewScrollActivitySource);
		for (const consumer of previewRowConsumers.values()) consumer(false);
		previewRowConsumers.clear();
		observedChunks.clear();
		interactionController.clear();
		previewSurface.dispose();
	});

	function loadMore(sectionId: string): void {
		const nextDocument = documentProjection.loadMore(sectionId);
		if (nextDocument) publishDocument(nextDocument, false);
	}

	return {
		get rootEl() {
			return rootEl;
		},
		set rootEl(next: HTMLDivElement | null) {
			rootEl = next;
		},
		get contentEl() {
			return contentEl;
		},
		set contentEl(next: HTMLDivElement | null) {
			contentEl = next;
		},
		get sentinelEl() {
			return sentinelEl;
		},
		set sentinelEl(next: HTMLDivElement | null) {
			sentinelEl = next;
		},
		get layout() {
			return layout;
		},
		get plan() {
			return plan;
		},
		get observerRoot() {
			return rootEl ? findNearestScrollContainer(rootEl) : null;
		},
		get previewSurface() {
			return previewSurface;
		},
		get interactionDescriptorResolverProvider() {
			return interactionController.provider;
		},
		registerCardModelConsumer,
		registerPreviewRow,
		observeHydrationChunk,
		loadNextChunk,
		loadMore,
	};
}
