/** Scroll metrics used to decide whether more card-grid content should load. */
export interface ContentBottomPreloadMetrics {
	contentHeight: number;
	rootMargin: string;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
}

export function parseBottomRootMarginPx(rootMargin: string): number {
	const tokens = rootMargin.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return 0;
	}

	const bottomIndex = tokens.length <= 2 ? 0 : 2;
	const bottomToken = tokens[bottomIndex];
	const parsed = Number.parseFloat(bottomToken ?? "0");
	if (!Number.isFinite(parsed)) {
		return 0;
	}
	return parsed;
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
