import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "appConstants";
import { ensureCardRenderShadowSurface } from "ui/components/common/cardRenderShadowSurface";
import { findNearestScrollContainerCached } from "ui/virtualization/dom/scrollContainer";
import { getScrollMetrics } from "ui/virtualization/dom/virtualListMeasurementAdapter";
import { resolveCachedCardGridLayoutBase } from "ui/virtualization/dom/virtualListCardLayout";
import {
	subscribeScrollTarget,
	type ScrollPhase,
} from "ui/virtualization/scheduling/scrollTargetListeners";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";
import {
	createSectionVisibleCountsController,
	getSectionPaginationKey,
	type SectionPaginationApplicationStore,
} from "ui/virtualization/pagination";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { ResolvedCardLayoutSettings } from "ui/shared/layout/cardLayoutCssVars";
import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
import {
	createTwoHopDomPool,
	type TwoHopDomPool,
	type TwoHopDomRowSlot,
} from "features/two-hop/ui/twoHopDomPool";
import {
	createTwoHopGeometry,
	resolveTwoHopCell,
	resolveTwoHopCellInRowInto,
	resolveTwoHopVisibleRowsInto,
	createTwoHopResolvedCellBuffer,
	createTwoHopResolvedRowBuffer,
	resolveTwoHopRowInto,
	type TwoHopGeometry,
	type TwoHopRowRange,
	type TwoHopResolvedCell,
	type TwoHopResolvedCellBuffer,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	createTwoHopFrameBudgetTracker,
	type TwoHopFrameBudgetTracker,
} from "features/two-hop/ui/twoHopFrameBudget";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import { createTwoHopShellRenderer } from "features/two-hop/ui/twoHopShellRenderer";
import {
	createTwoHopSnapshot,
	type TwoHopSnapshot,
} from "features/two-hop/ui/viewport/twoHopSnapshot";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createTwoHopInteractionRouter } from "features/two-hop/ui/twoHopInteractionRouter";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualNavigationTarget } from "ui/virtualization/types";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";
import type { App, TFile } from "obsidian";
import {
	createTwoHopPreviewHydrator,
	type TwoHopPreviewHydrator,
} from "features/two-hop/ui/twoHopPreviewHydrator";

const BEHIND_ROWS = 4;
const AHEAD_ROWS = 8;
const MINIMUM_POOL_ROWS = 12;

export interface TwoHopViewportControllerParams {
	readonly rootEl: HTMLDivElement;
	readonly shadowHostEl: HTMLDivElement;
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	/** Invalidates rich card models, including preview and search state. */
	readonly revision?: unknown;
	/** Invalidates only the titles materialized into the visible snapshot. */
	readonly shellTitleRevision?: unknown;
	readonly applicationStore?: SectionPaginationApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly configuredLayout?: ResolvedCardLayoutSettings | null;
	readonly resolveItemCardModel?: (
		item: TwoHopVirtualListItem,
		presentation: TwoHopCardPresentationState,
	) => CardRenderModel;
	readonly resolveItemTitle: (item: TwoHopVirtualListItem) => string;
	readonly getItemInteractionDescriptor: (
		item: TwoHopVirtualListItem,
	) => InteractionDescriptor | null;
	readonly getPreview?: (
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	) => Promise<PreviewData>;
	readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame?: (handle: number) => void;
	readonly now?: () => number;
	readonly previewApp?: App;
	readonly previewSourcePath?: string;
}

export interface TwoHopViewportControllerStats {
	readonly scrollFrames: number;
	readonly residentHits: number;
	readonly shellBinds: number;
	readonly skeletonBinds: number;
	readonly distantJumps: number;
	readonly poolRows: number;
	readonly previewRequested: number;
	readonly previewCommitted: number;
	readonly stalePreviewCompletions: number;
}

export interface TwoHopViewportController {
	readonly shadowRoot: ShadowRoot;
	readonly contentEl: HTMLDivElement;
	readonly scrollContainerEl: HTMLElement | null;
	setSections(
		sections: readonly TwoHopVirtualSectionDescriptor[],
		revision?: unknown,
		shellTitleRevision?: unknown,
	): void;
	setConfiguredLayout(layout: ResolvedCardLayoutSettings | null): void;
	setPreviewActive(active: boolean): void;
	loadMore(sectionId: string): void;
	resolveInteractionDescriptor(interactionId: string): InteractionDescriptor | null;
	resolveNavigationTarget(
		currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	): VirtualNavigationTarget | null;
	flush(timestamp?: number): void;
	getStats(): TwoHopViewportControllerStats;
	dispose(): void;
}

const activeTwoHopScrollers = new WeakSet<EventTarget>();

function acquireTwoHopScroller(scrollTarget: EventTarget): () => void {
	if (activeTwoHopScrollers.has(scrollTarget)) {
		throw new Error("Only one two-hop virtual list is allowed per scroller.");
	}

	activeTwoHopScrollers.add(scrollTarget);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeTwoHopScrollers.delete(scrollTarget);
	};
}

/** Owns scroll geometry and a fixed imperative DOM pool outside Svelte state. */
export function createTwoHopViewportController(
	params: TwoHopViewportControllerParams,
): TwoHopViewportController {
	const ownerWindow = params.rootEl.ownerDocument.defaultView;
	const initialScrollContainerEl = findNearestScrollContainerCached(params.rootEl);
	const scrollTarget = initialScrollContainerEl ?? ownerWindow!;
	const requestFrame =
		params.requestAnimationFrame ??
		ownerWindow?.requestAnimationFrame.bind(ownerWindow) ??
		((callback: FrameRequestCallback) =>
			ownerWindow?.setTimeout(() => callback(performance.now()), 16) ?? 0);
	const cancelFrame =
		params.cancelAnimationFrame ??
		ownerWindow?.cancelAnimationFrame.bind(ownerWindow) ??
		((handle: number) => ownerWindow?.clearTimeout(handle));
	const now =
		params.now ?? (() => ownerWindow?.performance.now() ?? performance.now());
	const pagination = createSectionVisibleCountsController<
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor["section"]
	>({
		applicationStore: params.applicationStore,
		initialVisibleCount: params.initialVisibleCount,
		loadMoreIncrement: params.loadMoreIncrement,
	});
	const shadowSurface = ensureCardRenderShadowSurface(params.shadowHostEl);
	const contentEl = params.rootEl.ownerDocument.createElement("div");
	shadowSurface.surfaceEl.append(contentEl);
	const renderer = createTwoHopShellRenderer({
		resolveItemCardModel: params.resolveItemCardModel,
	});
	const frameBudgetTracker = createTwoHopFrameBudgetTracker();
	let sections = params.sections;
	let configuredLayout = params.configuredLayout ?? null;
	let snapshot: TwoHopSnapshot;
	let geometry: TwoHopGeometry;
	let layout: ViewPlanLayoutMetrics;
	let pool: TwoHopDomPool;
	const scrollContainerEl = initialScrollContainerEl;
	let cachedSectionTop = 0;
	let cachedViewportHeight = 0;
	let residentStart = -1;
	let residentEnd = -1;
	let frameHandle = 0;
	let scrollActive = false;
	let needsScroll = false;
	let needsResize = false;
	let needsRefill = false;
	let lastMeasuredRowOffset = 0;
	let lastMeasuredTimestamp = 0;
	let disposed = false;
	let previewActive = true;
	let revision = params.revision;
	let shellTitleRevision = params.shellTitleRevision;
	const visibleRange: TwoHopRowRange = { start: 0, end: 0 };
	let stats = {
		scrollFrames: 0,
		residentHits: 0,
		shellBinds: 0,
		skeletonBinds: 0,
		distantJumps: 0,
	};
	const interactionRouter = createTwoHopInteractionRouter({
		getSnapshot: () => snapshot,
		getGeometry: () => geometry,
	});

	refreshScrollGeometry();
	const visibleCountUpdate = pagination.resolveForInput(sections);
	layout = measureLayout();
	snapshot = createSnapshot(visibleCountUpdate.snapshot.visibleCounts);
	geometry = createTwoHopGeometry(snapshot, layout);
	pool = createPool();
	let pendingShellSlots = createPendingShellSlots();
	let pendingShellCount = 0;
	applyLayoutStyles();
	pool.setContentHeight(geometry.totalHeight);
	let previewHydrator = createPreviewHydrator();
	let cellBuffers = createCellBuffers();
	const rowBuffer = createTwoHopResolvedRowBuffer();

	function refreshScrollGeometry(): boolean {
		const metrics = getScrollMetrics(params.rootEl, scrollContainerEl);
		const changed =
			metrics.sectionTop !== cachedSectionTop ||
			metrics.viewportHeight !== cachedViewportHeight;
		cachedSectionTop = metrics.sectionTop;
		cachedViewportHeight = metrics.viewportHeight;
		return changed;
	}

	function readScrollTop(): number {
		return scrollContainerEl
			? scrollContainerEl.scrollTop
			: (ownerWindow?.scrollY ?? ownerWindow?.pageYOffset ?? 0);
	}

	function measureLayout(): ViewPlanLayoutMetrics {
		const rootRect = params.rootEl.getBoundingClientRect();
		const measured = resolveCachedCardGridLayoutBase({
			rootEl: params.rootEl,
			rootRect,
			measuredWidth: params.rootEl.clientWidth || rootRect.width || null,
			defaults: DEFAULT_VIEW_PLAN_CARD_LAYOUT,
			listKind: "view-plan",
			scrollContainerEl,
			configuredLayout,
		});
		return {
			containerWidth: measured.containerWidth,
			columns: measured.columns,
			cellWidth: measured.cellWidth,
			rowHeight: measured.rowHeight,
			gap: measured.gap,
			sectionMarginBottom: measured.cardLayout.sectionMarginBottomPx,
		};
	}

	function createSnapshot(
		visibleCounts: Readonly<Record<string, number>>,
		previousSnapshot?: TwoHopSnapshot,
	): TwoHopSnapshot {
		return createTwoHopSnapshot({
			sections,
			visibleCounts,
			initialVisibleCount: params.initialVisibleCount ?? Number.POSITIVE_INFINITY,
			revision: shellTitleRevision,
			resolveItemTitle: params.resolveItemTitle,
			previousSnapshot,
		});
	}

	function createPool(): TwoHopDomPool {
		return createTwoHopDomPool({
			content: contentEl,
			rowCapacity: resolveRequiredPoolRows(layout),
			columns: layout.columns,
		});
	}

	function resolveRequiredPoolRows(nextLayout: ViewPlanLayoutMetrics): number {
		const viewportRows = Math.ceil(
			Math.max(nextLayout.rowHeight, cachedViewportHeight) /
				(nextLayout.rowHeight + nextLayout.gap),
		);
		return Math.max(MINIMUM_POOL_ROWS, viewportRows + BEHIND_ROWS + AHEAD_ROWS);
	}

	function createCellBuffers(): TwoHopResolvedCellBuffer[] {
		const buffers: TwoHopResolvedCellBuffer[] = [];
		const cellCount = pool.capacity * pool.columns;
		for (let index = 0; index < cellCount; index += 1) {
			buffers.push(createTwoHopResolvedCellBuffer());
		}
		return buffers;
	}

	function createPendingShellSlots(): Uint8Array {
		return new Uint8Array(pool.capacity * pool.columns);
	}

	function applyLayoutStyles(): void {
		const content = contentEl;
		content.style.setProperty("--ccl-columns", String(layout.columns));
		content.style.setProperty("--ccl-cell-width", `${layout.cellWidth}px`);
		content.style.setProperty("--ccl-box-height", `${layout.rowHeight}px`);
		content.style.setProperty("--ccl-box-gap", `${layout.gap}px`);
	}

	function createPreviewHydrator(): TwoHopPreviewHydrator | null {
		if (DEBUG_DISABLE_CARD_DOM_PREVIEW || !params.getPreview) {
			return null;
		}

		const hydrator = createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: params.getPreview,
			app: params.previewApp,
			sourcePath: params.previewSourcePath,
		});
		hydrator.setActive(previewActive);
		return hydrator;
	}

	function handleScrollPhase(phase: ScrollPhase): void {
		switch (phase) {
			case "start":
				scrollActive = true;
				return;
			case "scroll":
				needsScroll = true;
				scheduleFrame();
				return;
			case "idle":
				scrollActive = false;
				if (needsResize || needsRefill) scheduleFrame();
		}
	}

	function scheduleFrame(): void {
		if (frameHandle || disposed) return;
		frameHandle = requestFrame(runFrame);
	}

	function runFrame(timestamp: number): void {
		frameHandle = 0;
		if (needsScroll) {
			needsScroll = false;
			flush(timestamp);
		}
		if (!scrollActive && needsResize) {
			needsResize = false;
			applyResize(timestamp);
		}
		if (!needsScroll && !scrollActive && needsRefill) {
			needsRefill = false;
			refill(timestamp);
		}
		if (needsScroll || (!scrollActive && (needsResize || needsRefill))) {
			scheduleFrame();
		}
	}

	function flush(timestamp = now()): void {
		if (disposed) return;
		stats.scrollFrames += 1;
		const localScrollOffset = Math.max(0, readScrollTop() - cachedSectionTop);
		resolveTwoHopVisibleRowsInto(
			visibleRange,
			geometry,
			localScrollOffset,
			Math.max(geometry.rowHeight, cachedViewportHeight),
		);
		const rowOffset = localScrollOffset / Math.max(1, geometry.rowStride);
		const elapsed = timestamp - lastMeasuredTimestamp;
		const velocityRowsPerMs =
			lastMeasuredTimestamp > 0 && elapsed > 0
				? (rowOffset - lastMeasuredRowOffset) / elapsed
				: 0;
		lastMeasuredRowOffset = rowOffset;
		lastMeasuredTimestamp = timestamp;
		const nextStart = Math.max(0, visibleRange.start - BEHIND_ROWS);
		const nextEnd = Math.min(geometry.rowCount, nextStart + pool.capacity);

		if (
			residentStart >= 0 &&
			visibleRange.start >= residentStart &&
			visibleRange.end <= residentEnd
		) {
			stats.residentHits += 1;
			notifyViewport(scrollActive, velocityRowsPerMs);
			return;
		}

		const distantJump =
			residentStart >= 0 &&
			(nextEnd <= residentStart || nextStart >= residentEnd);
		if (distantJump) stats.distantJumps += 1;
		frameBudgetTracker.beginFrame(timestamp);
		bindResidentWindow(
			nextStart,
			nextEnd,
			visibleRange,
			distantJump,
			frameBudgetTracker,
		);
		residentStart = nextStart;
		residentEnd = nextEnd;
		notifyViewport(scrollActive, velocityRowsPerMs);
		scheduleRefill();
	}

	function notifyViewport(scrollActive: boolean, velocityRowsPerMs: number): void {
		if (!previewActive || !previewHydrator) return;
		previewHydrator.notifyViewport(
			visibleRange.start,
			visibleRange.end,
			scrollActive,
			velocityRowsPerMs,
			pendingShellCount > 0,
		);
	}

	function bindResidentWindow(
		start: number,
		end: number,
		visible: TwoHopRowRange,
		distantJump: boolean,
		budget: TwoHopFrameBudgetTracker,
	): void {
		const previousStart = residentStart;
		const previousEnd = residentEnd;
		if (previousStart < 0 || distantJump) {
			for (const rowSlot of pool.rows) hideRow(rowSlot);
			bindRowRange(start, end, visible, distantJump, budget);
			return;
		}

		hideLogicalRowRange(previousStart, Math.min(previousEnd, start));
		hideLogicalRowRange(Math.max(previousStart, end), previousEnd);
		bindRowRange(start, Math.min(end, previousStart), visible, false, budget);
		bindRowRange(Math.max(start, previousEnd), end, visible, false, budget);
	}

	function hideLogicalRowRange(start: number, end: number): void {
		for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
			const rowSlot = pool.rows[rowIndex % pool.capacity];
			if (rowSlot.logicalRowIndex === rowIndex) hideRow(rowSlot);
		}
	}

	function hideRow(rowSlot: TwoHopDomRowSlot): void {
		for (const slot of rowSlot.cells) {
			if (pendingShellSlots[slot.slotIndex] === 0) continue;
			pendingShellSlots[slot.slotIndex] = 0;
			pendingShellCount -= 1;
		}
		pool.hideRow(rowSlot);
	}

	function bindRowRange(
		start: number,
		end: number,
		visible: TwoHopRowRange,
		distantJump: boolean,
		budget: TwoHopFrameBudgetTracker,
	): void {
		for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
			const rowSlot = pool.rows[rowIndex % pool.capacity];
			if (rowSlot.logicalRowIndex === rowIndex) continue;
			const isVisible = rowIndex >= visible.start && rowIndex < visible.end;
			const canBindRich =
				(residentStart < 0 && isVisible) ||
				((!distantJump || isVisible) && budget.canBind(now()));
			const shellBindCount = bindRow(rowSlot, rowIndex, canBindRich, true);
			if (canBindRich) budget.consumeBinds(shellBindCount);
		}
	}

	function bindRow(
		rowSlot: TwoHopDomRowSlot,
		rowIndex: number,
		rich: boolean,
		position = false,
	): number {
		if (!resolveTwoHopRowInto(geometry, rowIndex, rowBuffer)) return 0;
		if (position) pool.positionRow(rowSlot, rowIndex, rowBuffer.top);
		let shellBindCount = 0;
		for (let columnIndex = 0; columnIndex < pool.columns; columnIndex += 1) {
			const slot = rowSlot.cells[columnIndex];
			const cell = resolveTwoHopCellInRowInto(
				snapshot,
				geometry,
				rowBuffer,
				columnIndex,
				cellBuffers[slot.slotIndex],
			);
			if (rich && cell) {
				renderer.renderShell(slot, cell, snapshot);
				stats.shellBinds += 1;
				shellBindCount += 1;
			} else {
				renderer.renderSkeleton(slot, cell, snapshot);
				stats.skeletonBinds += 1;
			}
			setSlotPending(slot.slotIndex, !slot.rich && Boolean(slot.logicalIdentity));
		}
		return shellBindCount;
	}

	function setSlotPending(slotIndex: number, pending: boolean): void {
		const nextValue = pending ? 1 : 0;
		if (pendingShellSlots[slotIndex] === nextValue) return;
		pendingShellSlots[slotIndex] = nextValue;
		pendingShellCount += pending ? 1 : -1;
	}

	function scheduleRefill(): void {
		if (disposed || pendingShellCount === 0) return;
		needsRefill = true;
		if (!scrollActive) scheduleFrame();
	}

	function refill(timestamp: number): void {
		if (disposed || residentStart < 0 || pendingShellCount === 0) return;
		frameBudgetTracker.beginFrame(timestamp);

		for (let rowIndex = residentStart; rowIndex < residentEnd; rowIndex += 1) {
			const rowSlot = pool.rows[rowIndex % pool.capacity];
			if (rowSlot.logicalRowIndex !== rowIndex) continue;
			let rowNeedsRichBind = false;
			for (const cell of rowSlot.cells) {
				if (pendingShellSlots[cell.slotIndex] !== 0) {
					rowNeedsRichBind = true;
					break;
				}
			}
			if (!rowNeedsRichBind) continue;
			if (!frameBudgetTracker.canBind(now())) {
				break;
			}
			const shellBindCount = bindRow(rowSlot, rowIndex, true);
			frameBudgetTracker.consumeBinds(shellBindCount);
		}

		if (pendingShellCount > 0) scheduleRefill();
		else previewHydrator?.notifyShellsChanged();
	}

	function rebuildData(anchorSectionIndex = -1, reusePreviousSnapshot = false): void {
		const localScrollOffset = Math.max(0, readScrollTop() - cachedSectionTop);
		const previousGeometry = geometry;
		const previousSnapshot = snapshot;
		const visibleCounts =
			pagination.resolveForInput(sections).snapshot.visibleCounts;
		snapshot = createSnapshot(
			visibleCounts,
			reusePreviousSnapshot ? previousSnapshot : undefined,
		);
		geometry = createTwoHopGeometry(snapshot, layout);
		pool.setContentHeight(geometry.totalHeight);
		if (
			anchorSectionIndex >= 0 &&
			anchorSectionIndex < previousGeometry.topBySection.length &&
			previousGeometry.topBySection[anchorSectionIndex] +
				previousGeometry.heightBySection[anchorSectionIndex] <=
				localScrollOffset
		) {
			const delta =
				(geometry.heightBySection[anchorSectionIndex] ?? 0) -
				(previousGeometry.heightBySection[anchorSectionIndex] ?? 0);
			if (scrollContainerEl) scrollContainerEl.scrollTop += delta;
			else ownerWindow?.scrollBy(0, delta);
		}
		for (const row of pool.rows) hideRow(row);
		pendingShellCount = 0;
		needsRefill = false;
		residentStart = -1;
		residentEnd = -1;
		flush(now());
		previewHydrator?.notifyShellsChanged();
	}

	function loadMore(sectionId: string): void {
		const sectionIndex = sections.findIndex(
			(section) => section.sectionId === sectionId,
		);
		if (sectionIndex < 0) return;
		const section = sections[sectionIndex];
		const paginationKey = getSectionPaginationKey(section);
		const result = pagination.loadMore(paginationKey, section.loadedCount);
		if (!result.changed) return;
		rebuildData(sectionIndex, true);
	}

	function resolveInteractionDescriptor(
		interactionId: string,
	): InteractionDescriptor | null {
		for (const rowSlot of pool.rows) {
			if (rowSlot.logicalRowIndex < 0) continue;
			for (const slot of rowSlot.cells) {
				if (slot.root.dataset.cclInteractionId !== interactionId) continue;
				const cell = resolveTwoHopCell(
					snapshot,
					geometry,
					rowSlot.logicalRowIndex,
					slot.logicalColumnIndex,
				);
				if (!cell) return null;
				if (cell.kind === "item") {
					return params.getItemInteractionDescriptor(cell.item);
				}
				if (cell.kind === "header") {
					return (
						snapshot.sections[cell.sectionIndex].descriptor.headerProps
							.interactionDescriptor ?? null
					);
				}
			}
		}
		return null;
	}

	function handleSurfaceClick(event: Event): void {
		for (const target of event.composedPath()) {
			if (!(target instanceof ownerWindow!.HTMLElement)) continue;
			const sectionId = target.dataset.twoHopLoadMoreSection;
			if (sectionId) {
				// This physical shell can become the first newly revealed card during
				// loadMore(). Consume the original click before rebinding so an outer
				// delegated handler cannot reinterpret it as that new card.
				event.preventDefault();
				event.stopPropagation();
				loadMore(sectionId);
				return;
			}
			const headerSectionId = target.dataset.twoHopHeaderSection;
			if (!headerSectionId) continue;
			sections
				.find((section) => section.sectionId === headerSectionId)
				?.headerProps.onClick?.();
			return;
		}
	}

	function handleSurfaceKeyDown(event: KeyboardEvent): void {
		if (event.key !== "Enter" && event.key !== " ") return;
		for (const target of event.composedPath()) {
			if (!(target instanceof ownerWindow!.HTMLElement)) continue;
			if (
				!target.dataset.twoHopLoadMoreSection &&
				!target.dataset.twoHopHeaderSection
			) {
				continue;
			}
			event.preventDefault();
			target.click();
			return;
		}
	}

	function scheduleResize(): void {
		if (disposed) return;
		needsResize = true;
		if (!scrollActive) scheduleFrame();
	}

	function applyResize(timestamp: number): boolean {
		const scrollGeometryChanged = refreshScrollGeometry();
		const nextLayout = measureLayout();
		const layoutUnchanged =
			nextLayout.columns === layout.columns &&
			nextLayout.rowHeight === layout.rowHeight &&
			nextLayout.gap === layout.gap &&
			nextLayout.sectionMarginBottom === layout.sectionMarginBottom;
		const requiresLargerPool = resolveRequiredPoolRows(nextLayout) > pool.capacity;
		if (layoutUnchanged && !requiresLargerPool) {
			if (scrollGeometryChanged) flush(timestamp);
			return scrollGeometryChanged;
		}
		layout = nextLayout;
		geometry = createTwoHopGeometry(snapshot, layout);
		previewHydrator?.dispose();
		pool.dispose();
		pool = createPool();
		pendingShellSlots = createPendingShellSlots();
		pendingShellCount = 0;
		needsRefill = false;
		cellBuffers = createCellBuffers();
		previewHydrator = createPreviewHydrator();
		applyLayoutStyles();
		pool.setContentHeight(geometry.totalHeight);
		residentStart = -1;
		residentEnd = -1;
		flush(timestamp);
		return true;
	}

	const resizeObserver = ownerWindow?.ResizeObserver
		? new ownerWindow.ResizeObserver(scheduleResize)
		: null;
	let releaseScroller: (() => void) | null = null;
	let unsubscribeScroll: (() => void) | null = null;
	contentEl.addEventListener("click", handleSurfaceClick);
	contentEl.addEventListener("keydown", handleSurfaceKeyDown);
	try {
		releaseScroller = acquireTwoHopScroller(scrollTarget);
		unsubscribeScroll = subscribeScrollTarget(scrollTarget, handleScrollPhase);
		resizeObserver?.observe(params.rootEl);
		const resized = applyResize(now());
		if (!resized) flush(now());
		if (pendingShellCount > 0) scheduleRefill();
	} catch (error) {
		unsubscribeScroll?.();
		resizeObserver?.disconnect();
		releaseScroller?.();
		contentEl.removeEventListener("click", handleSurfaceClick);
		contentEl.removeEventListener("keydown", handleSurfaceKeyDown);
		previewHydrator?.dispose();
		pool.dispose();
		contentEl.remove();
		shadowSurface.dispose();
		throw error;
	}

	return {
		shadowRoot: shadowSurface.shadowRoot,
		contentEl,
		get scrollContainerEl() {
			return scrollContainerEl;
		},
		setSections(nextSections, nextRevision, nextShellTitleRevision) {
			if (
				sections === nextSections &&
				revision === nextRevision &&
				shellTitleRevision === nextShellTitleRevision
			) {
				return;
			}
			const canReuseTitleSnapshot = shellTitleRevision === nextShellTitleRevision;
			if (
				revision !== nextRevision ||
				shellTitleRevision !== nextShellTitleRevision
			) {
				renderer.invalidateCardModels();
			}
			sections = nextSections;
			revision = nextRevision;
			shellTitleRevision = nextShellTitleRevision;
			rebuildData(-1, canReuseTitleSnapshot);
		},
		setConfiguredLayout(nextLayout) {
			if (configuredLayout === nextLayout) return;
			configuredLayout = nextLayout;
			scheduleResize();
		},
		setPreviewActive(active) {
			if (previewActive === active) return;
			previewActive = active;
			previewHydrator?.setActive(active);
		},
		loadMore,
		resolveInteractionDescriptor,
		resolveNavigationTarget: interactionRouter.resolveNavigationTarget,
		flush,
		getStats() {
			const previewStats = previewHydrator?.getStats();
			return {
				...stats,
				poolRows: pool.capacity,
				previewRequested: previewStats?.requested ?? 0,
				previewCommitted: previewStats?.committed ?? 0,
				stalePreviewCompletions: previewStats?.staleCompletions ?? 0,
			};
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribeScroll?.();
			unsubscribeScroll = null;
			resizeObserver?.disconnect();
			if (frameHandle) cancelFrame(frameHandle);
			releaseScroller?.();
			releaseScroller = null;
			previewHydrator?.dispose();
			contentEl.removeEventListener("click", handleSurfaceClick);
			contentEl.removeEventListener("keydown", handleSurfaceKeyDown);
			pool.dispose();
			contentEl.remove();
			shadowSurface.dispose();
		},
	};
}
