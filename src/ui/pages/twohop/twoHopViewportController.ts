import type { CardRenderShadowSurfaceHandles } from "ui/components/common/cardRenderShadowSurface";
import { ensureCardRenderShadowSurface } from "ui/components/common/cardRenderShadowSurface";
import { findNearestScrollContainerCached } from "ui/components/common/virtual-list/dom/scrollContainer";
import { getScrollMetrics } from "ui/components/common/virtual-list/dom/virtualListMeasurementAdapter";
import { resolveCachedCardGridLayoutBase } from "ui/components/common/virtual-list/dom/virtualListCardLayout";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	type ViewPlanLayoutMetrics,
} from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import {
	createSectionVisibleCountsController,
	getSectionPaginationKey,
	type SectionPaginationApplicationStore,
} from "ui/components/common/virtual-list/pagination";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { ResolvedCardLayoutSettings } from "ui/utils/cardLayoutCssVars";
import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
import { createTwoHopDomPool, type TwoHopDomPool, type TwoHopDomRowSlot } from "./twoHopDomPool";
import {
	createTwoHopGeometry,
	resolveTwoHopCell,
	resolveTwoHopCellInto,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleRows,
	createTwoHopResolvedCellBuffer,
	type TwoHopGeometry,
	type TwoHopResolvedCell,
	type TwoHopResolvedCellBuffer,
} from "./twoHopGeometry";
import { createTwoHopFrameBudgetTracker } from "./twoHopFrameBudget";
import type { TwoHopCardPresentationState } from "./twoHopCellStaticState";
import { createTwoHopShellRenderer } from "./twoHopShellRenderer";
import { createTwoHopSnapshot, type TwoHopSnapshot } from "./twoHopSnapshot";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "./twoHopVirtualListModel";
import { createTwoHopInteractionRouter } from "./twoHopInteractionRouter";
import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualNavigationTarget } from "ui/components/common/virtual-list/types";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";
import type { TFile } from "obsidian";
import {
	createTwoHopPreviewHydrator,
	type TwoHopPreviewHydrator,
} from "./twoHopPreviewHydrator";

const BEHIND_ROWS = 4;
const AHEAD_ROWS = 8;
const MINIMUM_POOL_ROWS = 12;
const SCROLL_IDLE_DELAY_MS = 120;

export interface TwoHopViewportControllerParams {
	readonly rootEl: HTMLDivElement;
	readonly shadowHostEl: HTMLDivElement;
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore?: SectionPaginationApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly configuredLayout?: ResolvedCardLayoutSettings | null;
	readonly resolveItemCardModel?: (
		item: TwoHopVirtualListItem,
		presentation: TwoHopCardPresentationState,
	) => CardRenderModel;
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
	): void;
	setConfiguredLayout(layout: ResolvedCardLayoutSettings | null): void;
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

/** Owns scroll geometry and a fixed imperative DOM pool outside Svelte state. */
export function createTwoHopViewportController(
	params: TwoHopViewportControllerParams,
): TwoHopViewportController {
	const ownerWindow = params.rootEl.ownerDocument.defaultView;
	const requestFrame =
		params.requestAnimationFrame ??
		ownerWindow?.requestAnimationFrame.bind(ownerWindow) ??
		((callback: FrameRequestCallback) =>
			ownerWindow?.setTimeout(() => callback(performance.now()), 16) ?? 0);
	const cancelFrame =
		params.cancelAnimationFrame ??
		ownerWindow?.cancelAnimationFrame.bind(ownerWindow) ??
		((handle: number) => ownerWindow?.clearTimeout(handle));
	const now = params.now ?? (() => ownerWindow?.performance.now() ?? performance.now());
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
	let scrollContainerEl = findNearestScrollContainerCached(params.rootEl);
	let cachedSectionTop = 0;
	let cachedViewportHeight = 0;
	let residentStart = -1;
	let residentEnd = -1;
	let frameHandle = 0;
	let refillFrameHandle = 0;
	let resizeFrameHandle = 0;
	let lastScrollEventAt = Number.NEGATIVE_INFINITY;
	let lastMeasuredRowOffset = 0;
	let lastMeasuredTimestamp = 0;
	let disposed = false;
	let revision: unknown;
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
	applyLayoutStyles();
	pool.setContentHeight(geometry.totalHeight);
	let previewHydrator = createPreviewHydrator();
	let cellBuffers = createCellBuffers();
	flush(now());

	function refreshScrollGeometry(): void {
		const metrics = getScrollMetrics(params.rootEl, scrollContainerEl);
		cachedSectionTop = metrics.sectionTop;
		cachedViewportHeight = metrics.viewportHeight;
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
	): TwoHopSnapshot {
		return createTwoHopSnapshot({
			sections,
			visibleCounts,
			initialVisibleCount: params.initialVisibleCount ?? Number.POSITIVE_INFINITY,
			revision,
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
		return Math.max(
			MINIMUM_POOL_ROWS,
			viewportRows + BEHIND_ROWS + AHEAD_ROWS,
		);
	}

	function createCellBuffers(): TwoHopResolvedCellBuffer[] {
		const buffers: TwoHopResolvedCellBuffer[] = [];
		const cellCount = pool.capacity * pool.columns;
		for (let index = 0; index < cellCount; index += 1) {
			buffers.push(createTwoHopResolvedCellBuffer());
		}
		return buffers;
	}

	function applyLayoutStyles(): void {
		const content = contentEl;
		content.style.setProperty("--ccl-columns", String(layout.columns));
		content.style.setProperty("--ccl-cell-width", `${layout.cellWidth}px`);
		content.style.setProperty("--ccl-box-height", `${layout.rowHeight}px`);
		content.style.setProperty("--ccl-box-gap", `${layout.gap}px`);
	}

	function createPreviewHydrator(): TwoHopPreviewHydrator | null {
		if (!params.getPreview) return null;
		return createTwoHopPreviewHydrator({
			getRows: () => pool.rows,
			getPreview: params.getPreview,
		});
	}

	function onScroll(): void {
		lastScrollEventAt = now();
		if (frameHandle) return;
		frameHandle = requestFrame((timestamp) => {
			frameHandle = 0;
			flush(timestamp);
		});
	}

	function flush(timestamp = now()): void {
		if (disposed) return;
		stats.scrollFrames += 1;
		const localScrollOffset = Math.max(0, readScrollTop() - cachedSectionTop);
		const visible = resolveTwoHopVisibleRows(
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
		const scrollActive = timestamp - lastScrollEventAt <= SCROLL_IDLE_DELAY_MS;
		const nextStart = Math.max(0, visible.start - BEHIND_ROWS);
		const nextEnd = Math.min(geometry.rowCount, nextStart + pool.capacity);

		if (
			residentStart >= 0 &&
			visible.start >= residentStart &&
			visible.end <= residentEnd
		) {
			stats.residentHits += 1;
			previewHydrator?.notifyViewport({
				visibleStart: visible.start,
				visibleEnd: visible.end,
				scrollActive,
				velocityRowsPerMs,
				criticalWorkPending: hasPendingShells(),
			});
			return;
		}

		const distantJump =
			residentStart >= 0 &&
			(nextEnd <= residentStart || nextStart >= residentEnd);
		if (distantJump) stats.distantJumps += 1;
		const budget = frameBudgetTracker.beginFrame(timestamp);
		bindResidentWindow(nextStart, nextEnd, visible, distantJump, budget);
		residentStart = nextStart;
		residentEnd = nextEnd;
		previewHydrator?.notifyViewport({
			visibleStart: visible.start,
			visibleEnd: visible.end,
			scrollActive,
			velocityRowsPerMs,
			criticalWorkPending: hasPendingShells(),
		});
		scheduleRefill();
	}

	function hasPendingShells(): boolean {
		for (const row of pool.rows) {
			if (row.logicalRowIndex < residentStart || row.logicalRowIndex >= residentEnd) {
				continue;
			}
			for (const slot of row.cells) {
				if (!slot.rich && slot.logicalIdentity) return true;
			}
		}
		return false;
	}

	function bindResidentWindow(
		start: number,
		end: number,
		visible: { readonly start: number; readonly end: number },
		distantJump: boolean,
		budget: ReturnType<typeof frameBudgetTracker.beginFrame>,
	): void {
		for (const rowSlot of pool.rows) {
			if (
				rowSlot.logicalRowIndex >= start &&
				rowSlot.logicalRowIndex < end
			) {
				continue;
			}
			pool.hideRow(rowSlot);
		}

		for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
			const rowSlot = pool.rows[rowIndex % pool.capacity];
			if (rowSlot.logicalRowIndex === rowIndex) continue;
			pool.positionRow(rowSlot, rowIndex, resolveTwoHopRowTop(geometry, rowIndex));
			const isVisible = rowIndex >= visible.start && rowIndex < visible.end;
			const canBindRich =
				(residentStart < 0 && isVisible) ||
				((!distantJump || isVisible) && budget.canBind(now()));
			bindRow(rowSlot, rowIndex, canBindRich);
			if (canBindRich) budget.consumeBind();
		}
	}

	function bindRow(
		rowSlot: TwoHopDomRowSlot,
		rowIndex: number,
		rich: boolean,
	): void {
		for (let columnIndex = 0; columnIndex < pool.columns; columnIndex += 1) {
			const slot = rowSlot.cells[columnIndex];
			const cell = resolveTwoHopCellInto(
				snapshot,
				geometry,
				rowIndex,
				columnIndex,
				cellBuffers[slot.slotIndex],
			);
			if (rich && cell) {
				renderer.renderShell(slot, cell, snapshot);
				stats.shellBinds += 1;
			} else {
				renderer.renderSkeleton(slot, cell, snapshot);
				stats.skeletonBinds += 1;
			}
		}
	}

	function scheduleRefill(): void {
		if (refillFrameHandle || disposed) return;
		refillFrameHandle = requestFrame((timestamp) => {
			refillFrameHandle = 0;
			refill(timestamp);
		});
	}

	function refill(timestamp: number): void {
		if (disposed || residentStart < 0) return;
		const budget = frameBudgetTracker.beginFrame(timestamp);
		let hasPending = false;

		for (let rowIndex = residentStart; rowIndex < residentEnd; rowIndex += 1) {
			const rowSlot = pool.rows[rowIndex % pool.capacity];
			if (rowSlot.logicalRowIndex !== rowIndex) continue;
			let rowNeedsRichBind = false;
			for (const cell of rowSlot.cells) {
				if (!cell.rich && cell.logicalIdentity) {
					rowNeedsRichBind = true;
					break;
				}
			}
			if (!rowNeedsRichBind) continue;
			if (!budget.canBind(now())) {
				hasPending = true;
				break;
			}
			bindRow(rowSlot, rowIndex, true);
			budget.consumeBind();
		}

		if (hasPending) scheduleRefill();
		else previewHydrator?.notifyShellsChanged();
	}

	function rebuildData(anchorSectionIndex = -1): void {
		const localScrollOffset = Math.max(0, readScrollTop() - cachedSectionTop);
		const previousGeometry = geometry;
		const visibleCounts = pagination.resolveForInput(sections).snapshot.visibleCounts;
		snapshot = createSnapshot(visibleCounts);
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
		rebuildData(sectionIndex);
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
		if (resizeFrameHandle || disposed) return;
		resizeFrameHandle = requestFrame(() => {
			resizeFrameHandle = 0;
			if (now() - lastScrollEventAt < SCROLL_IDLE_DELAY_MS) {
				scheduleResize();
				return;
			}
			refreshScrollGeometry();
			const nextLayout = measureLayout();
			const layoutUnchanged =
				nextLayout.columns === layout.columns &&
				nextLayout.rowHeight === layout.rowHeight &&
				nextLayout.gap === layout.gap &&
				nextLayout.sectionMarginBottom === layout.sectionMarginBottom;
			const requiresLargerPool =
				resolveRequiredPoolRows(nextLayout) > pool.capacity;
			if (layoutUnchanged && !requiresLargerPool) {
				return;
			}
			layout = nextLayout;
			geometry = createTwoHopGeometry(snapshot, layout);
			previewHydrator?.dispose();
			pool.dispose();
			pool = createPool();
			cellBuffers = createCellBuffers();
			previewHydrator = createPreviewHydrator();
			applyLayoutStyles();
			pool.setContentHeight(geometry.totalHeight);
			residentStart = -1;
			residentEnd = -1;
			flush(now());
		});
	}

	const resizeObserver = ownerWindow?.ResizeObserver
		? new ownerWindow.ResizeObserver(scheduleResize)
		: null;
	resizeObserver?.observe(params.rootEl);
	const scrollTarget: EventTarget = scrollContainerEl ?? ownerWindow!;
	scrollTarget.addEventListener("scroll", onScroll, { passive: true });
	contentEl.addEventListener("click", handleSurfaceClick);
	contentEl.addEventListener("keydown", handleSurfaceKeyDown);

	return {
		shadowRoot: shadowSurface.shadowRoot,
		contentEl,
		get scrollContainerEl() {
			return scrollContainerEl;
		},
		setSections(nextSections, nextRevision) {
			if (sections === nextSections && revision === nextRevision) return;
			if (revision !== nextRevision) renderer.invalidateCardModels();
			sections = nextSections;
			revision = nextRevision;
			rebuildData();
		},
		setConfiguredLayout(nextLayout) {
			if (configuredLayout === nextLayout) return;
			configuredLayout = nextLayout;
			scheduleResize();
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
			if (frameHandle) cancelFrame(frameHandle);
			if (refillFrameHandle) cancelFrame(refillFrameHandle);
			if (resizeFrameHandle) cancelFrame(resizeFrameHandle);
			resizeObserver?.disconnect();
			previewHydrator?.dispose();
			scrollTarget.removeEventListener("scroll", onScroll);
			contentEl.removeEventListener("click", handleSurfaceClick);
			contentEl.removeEventListener("keydown", handleSurfaceKeyDown);
			pool.dispose();
			contentEl.remove();
			shadowSurface.dispose();
		},
	};
}
