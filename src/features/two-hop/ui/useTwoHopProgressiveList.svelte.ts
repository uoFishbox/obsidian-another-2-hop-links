import { onDestroy, tick, untrack } from "svelte";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionProjection } from "features/two-hop/ui/twoHopSectionProjection";
import {
	compileFixedGridLayout,
	resolveTwoHopRowFromScrollOffset,
	type TwoHopRowRange,
	type TwoHopGeometry,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	appendTwoHopProgressivePlan,
	compileTwoHopProgressivePlan,
	resolveInitialProgressiveMountedRowEnd,
	resolveNextProgressiveMountedRowEnd,
	resolveMountedProgressiveRow,
	TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
	type TwoHopProgressivePlan,
} from "features/two-hop/ui/twoHopProgressivePlan";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import { DISABLED_PREVIEW_SURFACE } from "features/preview/runtime/previewRuntime";
import type {
	PreviewFrame,
	RowPreviewCardBinding,
	VirtualPreviewSurface,
} from "features/preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createResolvedCardLayoutSettingsMemo } from "ui/shared/layout/cardLayoutCssVars";
import { resolveCachedCardGridLayoutBase } from "ui/virtualization/dom/virtualListCardLayout";
import {
	DEFAULT_VIEW_PLAN_CARD_LAYOUT,
	DEFAULT_VIEW_PLAN_LAYOUT,
	isSameViewPlanLayout,
	type ViewPlanLayoutMetrics,
} from "ui/virtualization/svelte/viewPlanLayout";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import { collectPositionDependencyElements } from "ui/virtualization/dom/scrollContainerDependencies";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "ui/virtualization/scheduling/scrollActivity";
import {
	resolveProgressivePreviewRangeInto,
	resolveProgressiveResidentRangeInto,
} from "features/two-hop/ui/progressivePreviewRange";
import { createTwoHopCardHydrator } from "features/two-hop/ui/twoHopCardHydrator";
import { createTwoHopPreviewWindowController } from "features/two-hop/ui/twoHopPreviewWindowController";

export interface TwoHopProgressiveListProps {
	/** Stable identity of the displayed file and search scope. */
	readonly documentIdentity: string;
	readonly sections: readonly TwoHopSectionModel[];
	readonly applicationStore: ApplicationStore;
	readonly previewDependencies?: TwoHopPreviewDependencies;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationScope?: string;
	readonly previewActive?: boolean;
	/** Explicit invalidation value for card models resolved by resolveItemCardModel. */
	readonly cardModelRevision: unknown;
	readonly resolveItemCardModel?: (
		item: TwoHopItemModel,
		presentation: TwoHopCardPresentationState,
		revision: unknown,
	) => CardRenderModel;
}

interface LayoutAnchor {
	readonly logicalKey: string;
	readonly viewportOffset: number;
	readonly scrollTop: number;
	readonly scrollRoot: HTMLElement | null;
}

type SectionPublicationKind = "identity-reset" | "data-revision";
const EMPTY_PREVIEW_RANGE = Object.freeze({ start: 0, end: 0 });
const PREVIEW_SCROLL_TASK_KEY = "two-hop-progressive-preview-window";
const PREVIEW_RANGE_APPLY_TASK_KEY = "two-hop-progressive-preview-window-apply";
const PREVIEW_SCROLL_IDLE_MS = 140;

export function resolveProgressivePreviewSlotId(logicalKey: string): string {
	return `two-hop-progressive:${logicalKey}`;
}

/** Owns append-only chunk publication, lazy model hydration, and bounded preview state. */
export function useTwoHopProgressiveList(
	props: TwoHopProgressiveListProps,
	frameCoordinator: VirtualFrameCoordinator,
) {
	const applicationStore = props.applicationStore;
	const sectionProjection = createTwoHopSectionProjection({
		sections: props.sections,
		applicationStore,
		initialVisibleCount: props.initialVisibleCount,
		loadMoreIncrement: props.loadMoreIncrement,
		paginationScope: props.paginationScope,
	});
	const initialSections = sectionProjection.getSections();
	const initialGeometry = compileFixedGridLayout(
		initialSections,
		DEFAULT_VIEW_PLAN_LAYOUT,
	);
	const initialMountedRowEnd = resolveInitialProgressiveMountedRowEnd(
		initialGeometry.rowCount,
	);
	let sections = $state.raw<readonly TwoHopSectionModel[]>(initialSections);
	let layout = $state.raw<ViewPlanLayoutMetrics>(DEFAULT_VIEW_PLAN_LAYOUT);
	let geometry = $state.raw<TwoHopGeometry>(initialGeometry);
	let plan = $state.raw<TwoHopProgressivePlan>(
		compileTwoHopProgressivePlan(
			initialSections,
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
	const previewBindingByLogicalKey = new Map<string, RowPreviewCardBinding>();
	const visibleHydrationRange: TwoHopRowRange = { start: 0, end: 0 };
	const previewWindow = createTwoHopPreviewWindowController(
		schedulePreviewPublication,
	);
	const nextVisibleHydrationRange: TwoHopRowRange = { start: 0, end: 0 };
	const nextResidentPreviewRange: TwoHopRowRange = { start: 0, end: 0 };
	let sentinelObserver: IntersectionObserver | undefined;
	let previewRangeAnimationFrame: number | undefined;
	let previewViewportRefreshAnimationFrame: number | undefined;
	let previewViewportRefreshOwnerWindow: Window | null = null;
	let previewScrollIdleTimer: number | undefined;
	let lastPreviewScrollAt = 0;
	let previewScrollActive = false;
	let previewScrollContainer: HTMLElement | null = null;
	let previewOwnerWindow: Window | null = null;
	let contentTopInScrollSpace = 0;
	let previewViewportHeight = 0;
	let previewPublicationScheduled = false;
	let lastDocumentIdentity = props.documentIdentity;
	let lastCardModelRevision = props.cardModelRevision;
	const cardHydrator = createTwoHopCardHydrator({
		frameCoordinator,
		getPlan: () => untrack(() => plan),
		getRevision: () => untrack(() => props.cardModelRevision),
		getResolver: () => untrack(() => props.resolveItemCardModel),
		isPreviewActive: isPreviewControlActive,
		onPreviewModelsChanged: schedulePreviewPublication,
	});

	function isPreviewControlActive(): boolean {
		return props.previewActive !== false;
	}

	function isPreviewSurfaceActive(): boolean {
		return props.previewDependencies !== undefined && isPreviewControlActive();
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
		const active = isPreviewSurfaceActive();
		const bindings = new Map<string, RowPreviewCardBinding>();

		if (active) {
			const activePlan = untrack(() => plan);
			for (
				let rowIndex = previewWindow.residentRange.start;
				rowIndex < previewWindow.residentRange.end;
				rowIndex += 1
			) {
				const row = resolveMountedProgressiveRow(activePlan, rowIndex);
				if (!row) continue;
				for (const cell of row.cells) {
					if (cell.kind !== "item") continue;
					const model = cardHydrator.getActivatedModel(cell.logicalKey);
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

		const previewRange = active
			? Object.freeze({
					start: previewWindow.activeRange.start,
					end: previewWindow.activeRange.end,
				})
			: EMPTY_PREVIEW_RANGE;
		const frame: PreviewFrame = Object.freeze({
			previewBindingsBySlot: bindings,
			previewWindow: Object.freeze({ previewRange, active }),
		});
		previewSurface.publish(frame);
	}

	function applyVisibleHydrationRange(next: TwoHopRowRange): void {
		if (
			visibleHydrationRange.start === next.start &&
			visibleHydrationRange.end === next.end
		) {
			return;
		}
		visibleHydrationRange.start = next.start;
		visibleHydrationRange.end = next.end;
		cardHydrator.replaceRange(next);
	}

	function deactivatePreviewControl(): void {
		nextResidentPreviewRange.start = 0;
		nextResidentPreviewRange.end = 0;
		previewWindow.clear();
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

	function refreshPreviewViewportGeometry(): void {
		previewViewportRefreshAnimationFrame = undefined;
		previewViewportRefreshOwnerWindow = null;
		if (disposed || !rootEl || !contentEl) return;
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
	}

	function schedulePreviewViewportRefresh(): void {
		if (
			disposed ||
			previewViewportRefreshAnimationFrame !== undefined ||
			!rootEl ||
			!contentEl
		) {
			return;
		}
		const ownerWindow = rootEl.ownerDocument.defaultView;
		if (!ownerWindow) return;
		previewViewportRefreshOwnerWindow = ownerWindow;
		previewViewportRefreshAnimationFrame = ownerWindow.requestAnimationFrame(
			refreshPreviewViewportGeometry,
		);
	}

	function flushPreviewRangeFromScroll(): void {
		previewRangeAnimationFrame = undefined;
		if (disposed) return;
		const activeGeometry = untrack(() => geometry);
		const mountedRowEnd = untrack(() => plan.mountedRowEnd);
		resolveProgressivePreviewRangeInto(
			nextVisibleHydrationRange,
			activeGeometry,
			readPreviewScrollTop() - contentTopInScrollSpace,
			previewViewportHeight,
			mountedRowEnd,
		);
		if (isPreviewControlActive()) {
			resolveProgressiveResidentRangeInto(
				nextResidentPreviewRange,
				nextVisibleHydrationRange,
				previewWindow.residentRange,
				mountedRowEnd,
			);
		} else {
			nextResidentPreviewRange.start = 0;
			nextResidentPreviewRange.end = 0;
		}
		const nextActivePreviewRange = isPreviewControlActive()
			? nextVisibleHydrationRange
			: EMPTY_PREVIEW_RANGE;
		if (
			nextVisibleHydrationRange.start === visibleHydrationRange.start &&
			nextVisibleHydrationRange.end === visibleHydrationRange.end &&
			nextActivePreviewRange.start === previewWindow.activeRange.start &&
			nextActivePreviewRange.end === previewWindow.activeRange.end &&
			nextResidentPreviewRange.start === previewWindow.residentRange.start &&
			nextResidentPreviewRange.end === previewWindow.residentRange.end
		) {
			return;
		}
		frameCoordinator.schedule(
			"post-paint",
			PREVIEW_RANGE_APPLY_TASK_KEY,
			applyPendingPreviewRange,
		);
	}

	function applyPendingPreviewRange(): void {
		if (disposed) return;
		applyVisibleHydrationRange(nextVisibleHydrationRange);
		if (!isPreviewControlActive()) {
			deactivatePreviewControl();
			return;
		}
		resolveProgressiveResidentRangeInto(
			nextResidentPreviewRange,
			nextVisibleHydrationRange,
			previewWindow.residentRange,
			untrack(() => plan.mountedRowEnd),
		);
		previewWindow.apply(nextVisibleHydrationRange, nextResidentPreviewRange);
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

	function ensurePreviewScrollIdleTimer(): void {
		if (previewScrollIdleTimer !== undefined) return;
		const ownerWindow = previewOwnerWindow;
		if (!ownerWindow) return;
		previewScrollIdleTimer = ownerWindow.setTimeout(
			checkPreviewScrollIdle,
			PREVIEW_SCROLL_IDLE_MS,
		);
	}

	function checkPreviewScrollIdle(): void {
		previewScrollIdleTimer = undefined;
		if (disposed) return;
		const remaining =
			PREVIEW_SCROLL_IDLE_MS - (performance.now() - lastPreviewScrollAt);
		const ownerWindow = previewOwnerWindow;
		if (remaining > 0 && ownerWindow) {
			previewScrollIdleTimer = ownerWindow.setTimeout(
				checkPreviewScrollIdle,
				remaining,
			);
			return;
		}
		previewScrollActive = false;
		markScrollActivityIdle(previewScrollActivitySource);
	}

	function cancelPreviewScrollIdle(): void {
		if (previewScrollIdleTimer !== undefined && previewOwnerWindow) {
			previewOwnerWindow.clearTimeout(previewScrollIdleTimer);
		}
		previewScrollIdleTimer = undefined;
		previewScrollActive = false;
		markScrollActivityIdle(previewScrollActivitySource);
	}

	const previewScrollActivitySource = {};
	function handlePreviewScroll(): void {
		lastPreviewScrollAt = performance.now();
		schedulePreviewRangeUpdate();
		if (!isPreviewControlActive()) return;
		if (!previewScrollActive) {
			previewScrollActive = true;
			markScrollActivityActive(previewScrollActivitySource);
		}
		ensurePreviewScrollIdleTimer();
	}

	function rebuildSentinelObserver(): void {
		sentinelObserver?.disconnect();
		sentinelObserver = undefined;
		if (!rootEl || typeof IntersectionObserver === "undefined") return;

		const observerRoot = findNearestScrollContainer(rootEl);
		const chunkPreloadDistancePx =
			geometry.rowStride * TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK;
		sentinelObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadNextChunk();
			},
			{
				root: observerRoot,
				rootMargin: `0px 0px ${chunkPreloadDistancePx}px 0px`,
			},
		);
		if (sentinelEl) sentinelObserver.observe(sentinelEl);
	}

	function loadNextChunk(): void {
		const currentMountedRowEnd = plan.mountedRowEnd;
		const nextEnd = resolveNextProgressiveMountedRowEnd(
			currentMountedRowEnd,
			geometry.rowCount,
		);
		if (nextEnd === currentMountedRowEnd) return;
		plan = appendTwoHopProgressivePlan(sections, geometry, plan, nextEnd);
		cardHydrator.replaceRange(visibleHydrationRange);
	}

	function captureLayoutAnchor(): LayoutAnchor | null {
		if (!rootEl?.shadowRoot) return null;
		const anchorRowIndex = resolveTwoHopRowFromScrollOffset(
			geometry,
			readPreviewScrollTop() - contentTopInScrollSpace,
		);
		if (anchorRowIndex === null || anchorRowIndex >= plan.mountedRowEnd) {
			return null;
		}
		const rowElement = rootEl.shadowRoot.querySelector<HTMLElement>(
			`[data-ccl-progressive-row="${anchorRowIndex}"]`,
		);
		const element = rowElement?.querySelector<HTMLElement>(
			"[data-ccl-logical-key]",
		);
		if (!element) return null;
		const scrollRoot = findNearestScrollContainer(rootEl);
		const viewportHeight =
			scrollRoot?.clientHeight ?? previewOwnerWindow?.innerHeight ?? 0;
		if (viewportHeight <= 0) return null;
		const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
		const viewportBottom = viewportTop + viewportHeight;
		const rect = element.getBoundingClientRect();
		if (
			rect.width <= 0 ||
			rect.height <= 0 ||
			rect.bottom <= viewportTop ||
			rect.top >= viewportBottom
		) {
			return null;
		}
		return {
			logicalKey: element.dataset.cclLogicalKey ?? "",
			viewportOffset: rect.top - viewportTop,
			scrollTop: readPreviewScrollTop(),
			scrollRoot,
		};
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
		if (scrollRoot !== anchor.scrollRoot) return;
		if (Math.abs(readPreviewScrollTop() - anchor.scrollTop) >= 0.5) return;
		const viewportTop = scrollRoot?.getBoundingClientRect().top ?? 0;
		const delta =
			element.getBoundingClientRect().top - viewportTop - anchor.viewportOffset;
		if (Math.abs(delta) < 0.5) return;
		if (scrollRoot) scrollRoot.scrollTop += delta;
		else window.scrollBy({ top: delta });
	}

	function measureLayout(preserveAnchor = true): void {
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
		const anchor = preserveAnchor ? captureLayoutAnchor() : null;
		const nextGeometry = compileFixedGridLayout(sections, nextLayout);
		const nextMountedRowEnd = Math.min(plan.mountedRowEnd, nextGeometry.rowCount);
		layout = nextLayout;
		geometry = nextGeometry;
		plan = compileTwoHopProgressivePlan(sections, nextGeometry, nextMountedRowEnd);
		void restoreLayoutAnchor(anchor);
	}

	function publishSections(
		nextSections: readonly TwoHopSectionModel[],
		kind: SectionPublicationKind,
	): void {
		if (nextSections === sections && kind === "data-revision") return;
		const anchor = kind === "data-revision" ? captureLayoutAnchor() : null;
		const nextGeometry = compileFixedGridLayout(nextSections, layout);
		const nextMountedRowEnd =
			kind === "identity-reset"
				? resolveInitialProgressiveMountedRowEnd(nextGeometry.rowCount)
				: Math.min(
						nextGeometry.rowCount,
						Math.max(
							plan.mountedRowEnd,
							resolveInitialProgressiveMountedRowEnd(
								nextGeometry.rowCount,
							),
						),
					);
		sections = nextSections;
		geometry = nextGeometry;
		const nextPlan = compileTwoHopProgressivePlan(
			nextSections,
			nextGeometry,
			nextMountedRowEnd,
		);
		plan = nextPlan;
		if (kind === "identity-reset") {
			previewBindingByLogicalKey.clear();
			cardHydrator.clear();
			cardHydrator.replaceRange(visibleHydrationRange);
			return;
		}
		cardHydrator.reconcile(nextPlan, visibleHydrationRange);
		void restoreLayoutAnchor(anchor);
	}

	$effect(() => {
		const nextDocumentIdentity = props.documentIdentity;
		const nextSections = sectionProjection.setInput({
			sections: props.sections,
			paginationScope: props.paginationScope ?? "",
			initialVisibleCount: props.initialVisibleCount,
			loadMoreIncrement: props.loadMoreIncrement,
		});
		const identityChanged = nextDocumentIdentity !== lastDocumentIdentity;
		if (identityChanged || nextSections !== sections) {
			lastDocumentIdentity = nextDocumentIdentity;
			publishSections(
				nextSections,
				identityChanged ? "identity-reset" : "data-revision",
			);
		}
	});

	$effect(() => {
		const revision = props.cardModelRevision;
		if (revision === lastCardModelRevision) return;
		lastCardModelRevision = revision;
		cardHydrator.refreshRanges(visibleHydrationRange, previewWindow.residentRange);
	});

	$effect(() => {
		const element = rootEl;
		const content = contentEl;
		void configuredLayout;
		if (!element || !content) return;
		const scrollContainer = findNearestScrollContainer(element);
		previewScrollContainer = scrollContainer;
		previewOwnerWindow = element.ownerDocument.defaultView;
		measureLayout();
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
		if (typeof ResizeObserver === "undefined") return;
		let previousRootInlineSize = element.clientWidth;
		let previousViewportClientWidth = scrollContainer?.clientWidth;
		let previousViewportClientHeight = scrollContainer?.clientHeight;
		const positionDependencyElements = new Set<Element>(
			collectPositionDependencyElements(element, scrollContainer),
		);
		const observer = new ResizeObserver((entries) => {
			const wasMeasurable =
				previousRootInlineSize > 0 &&
				(previousViewportClientHeight === undefined ||
					previousViewportClientHeight > 0);
			let viewportSizeChanged = false;
			let positionDependencyChanged = false;
			for (const entry of entries) {
				if (positionDependencyElements.has(entry.target)) {
					positionDependencyChanged = true;
				}
				if (entry.target === element) {
					const inlineSize =
						entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
					if (inlineSize !== previousRootInlineSize) {
						previousRootInlineSize = inlineSize;
						if (inlineSize > 0) {
							measureLayout(wasMeasurable);
						}
					}
				}

				if (entry.target !== scrollContainer) continue;
				const clientWidth = scrollContainer.clientWidth;
				const clientHeight = scrollContainer.clientHeight;
				if (
					clientWidth === previousViewportClientWidth &&
					clientHeight === previousViewportClientHeight
				) {
					continue;
				}
				previousViewportClientWidth = clientWidth;
				previousViewportClientHeight = clientHeight;
				viewportSizeChanged = true;
			}

			if (positionDependencyChanged) schedulePreviewViewportRefresh();
			if (!viewportSizeChanged) return;
			measurePreviewViewportGeometry();
			flushPreviewRangeFromScroll();
		});
		observer.observe(element);
		if (scrollContainer) observer.observe(scrollContainer);
		for (const dependencyElement of positionDependencyElements) {
			observer.observe(dependencyElement);
		}
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
			cancelPreviewScrollIdle();
		};
	});

	$effect(() => {
		void geometry;
		void plan.mountedRowEnd;
		if (!contentEl) return;
		flushPreviewRangeFromScroll();
	});

	$effect(() => {
		void rootEl;
		void contentEl;
		void sentinelEl;
		void geometry.rowStride;
		rebuildSentinelObserver();
		return () => {
			sentinelObserver?.disconnect();
		};
	});

	$effect(() => {
		const active = isPreviewControlActive();
		if (!active) {
			cancelPreviewScrollIdle();
			deactivatePreviewControl();
			schedulePreviewPublication();
			return;
		}
		if (!rootEl || !contentEl) {
			schedulePreviewPublication();
			return;
		}
		measurePreviewViewportGeometry();
		flushPreviewRangeFromScroll();
	});

	onDestroy(() => {
		disposed = true;
		cardHydrator.dispose();
		sentinelObserver?.disconnect();
		frameCoordinator.cancel("scroll-critical", PREVIEW_SCROLL_TASK_KEY);
		frameCoordinator.cancel("post-paint", PREVIEW_RANGE_APPLY_TASK_KEY);
		if (previewRangeAnimationFrame !== undefined && previewOwnerWindow) {
			previewOwnerWindow.cancelAnimationFrame(previewRangeAnimationFrame);
		}
		if (
			previewViewportRefreshAnimationFrame !== undefined &&
			previewViewportRefreshOwnerWindow
		) {
			previewViewportRefreshOwnerWindow.cancelAnimationFrame(
				previewViewportRefreshAnimationFrame,
			);
		}
		cancelPreviewScrollIdle();
		previewWindow.dispose();
		previewSurface.dispose();
	});

	function loadMore(sectionId: string): void {
		const nextSections = sectionProjection.loadMore(sectionId);
		if (nextSections) publishSections(nextSections, "data-revision");
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
			return cardHydrator.interactionDescriptorResolverProvider;
		},
		registerCardModelConsumer: cardHydrator.registerConsumer,
		registerPreviewRow: previewWindow.registerRow,
		loadNextChunk,
		loadMore,
	};
}
