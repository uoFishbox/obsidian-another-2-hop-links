import { tick } from "svelte";
import type { VirtualListStableMeasurementContext } from "cards/virtualization/public";
import { scheduleAnimationFrame } from "shared/ui/scheduling/frame";

const MAX_CHAINED_INFINITE_SCROLL_LOADS = 2;

interface ContentBottomPreloadMetrics {
	contentHeight: number;
	rootMargin: string;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
}

interface IntersectionObserverAdapter {
	observe(
		element: Element,
		callback: () => void,
		config: {
			root?: Element | Document | null;
			rootMargin: string;
			threshold: number;
		},
		once: boolean,
	): symbol;
	unobserve(token: symbol): void;
}

export interface FlatGridInfiniteScrollOptions {
	readonly observer: IntersectionObserverAdapter;
	getRootEl(): HTMLElement | null;
	getScrollContainerEl(): HTMLElement | null;
	getRootMargin(): string;
	getContentHeight(): number;
	getPreloadMetrics(): VirtualListStableMeasurementContext | null;
	shouldLoad(): boolean;
	loadNextPage(): void;
}

export interface FlatGridInfiniteScrollController {
	observe(sentinelEl: HTMLDivElement): () => void;
	considerLoading(context?: VirtualListStableMeasurementContext): void;
}

function parseBottomRootMarginPx(rootMargin: string): number {
	const tokens = rootMargin.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return 0;
	const parsed = Number.parseFloat(tokens[tokens.length <= 2 ? 0 : 2] ?? "0");
	return Number.isFinite(parsed) ? parsed : 0;
}

export function isContentBottomInPreloadRangeFromMetrics({
	contentHeight,
	rootMargin,
	scrollTop,
	viewportHeight,
	sectionTop,
}: ContentBottomPreloadMetrics): boolean {
	const preloadBottom =
		scrollTop + viewportHeight + parseBottomRootMarginPx(rootMargin);
	return sectionTop + contentHeight <= preloadBottom;
}

/** Owns sentinel observation and bounded chained pagination for one flat grid. */
export function createFlatGridInfiniteScrollController(
	options: FlatGridInfiniteScrollOptions,
): FlatGridInfiniteScrollController {
	let loadScheduled = false;
	let chainedLoads = 0;
	let cachedRootMargin = "";
	let cachedBottomRootMarginPx = 0;

	function isContentBottomInPreloadRange(
		metrics: VirtualListStableMeasurementContext,
	): boolean {
		const rootMargin = options.getRootMargin();
		if (rootMargin !== cachedRootMargin) {
			cachedRootMargin = rootMargin;
			cachedBottomRootMarginPx = parseBottomRootMarginPx(rootMargin);
		}
		const preloadBottom =
			metrics.scrollTop + metrics.viewportHeight + cachedBottomRootMarginPx;
		return metrics.sectionTop + options.getContentHeight() <= preloadBottom;
	}

	function scheduleLoadNextPage(): void {
		if (loadScheduled) return;

		loadScheduled = true;
		const rootEl = options.getRootEl();
		scheduleAnimationFrame(async () => {
			loadScheduled = false;
			options.loadNextPage();

			await tick();
			if (!options.getRootEl() || !options.shouldLoad()) return;

			const preloadMetrics = options.getPreloadMetrics();
			if (
				chainedLoads >= MAX_CHAINED_INFINITE_SCROLL_LOADS ||
				!preloadMetrics ||
				!isContentBottomInPreloadRange(preloadMetrics)
			) {
				return;
			}

			chainedLoads += 1;
			scheduleLoadNextPage();
		}, rootEl?.ownerDocument.defaultView);
	}

	function considerLoading(context?: VirtualListStableMeasurementContext): void {
		if (!options.getRootEl() || !options.shouldLoad()) return;

		const preloadMetrics = context ?? options.getPreloadMetrics();
		if (!preloadMetrics || !isContentBottomInPreloadRange(preloadMetrics)) {
			return;
		}

		chainedLoads = 0;
		scheduleLoadNextPage();
	}

	function observe(sentinelEl: HTMLDivElement): () => void {
		const token = options.observer.observe(
			sentinelEl,
			() => {
				chainedLoads = 0;
				scheduleLoadNextPage();
			},
			{
				rootMargin: options.getRootMargin(),
				threshold: 0,
				root: options.getScrollContainerEl(),
			},
			false,
		);

		return () => options.observer.unobserve(token);
	}

	return { observe, considerLoading };
}
