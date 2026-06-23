import type { VirtualListScrollSnapshot } from "./virtualListMeasurementAdapter";

const isFiniteRect = (rect: DOMRect): boolean =>
	Number.isFinite(rect.top) &&
	Number.isFinite(rect.bottom) &&
	Number.isFinite(rect.height);

export interface IsStableVirtualListMeasurementParams {
	hasRenderableContent: boolean;
	rootRect: DOMRect;
	viewportHeight: number;
	scrollTop: number;
	sectionTop: number;
}

export function isStableVirtualListMeasurement({
	hasRenderableContent,
	rootRect,
	viewportHeight,
	scrollTop,
	sectionTop,
}: IsStableVirtualListMeasurementParams): boolean {
	if (!hasRenderableContent) {
		return true;
	}
	const hasStableViewportHeight = viewportHeight > 0;
	const hasStableRootRect = isFiniteRect(rootRect) && rootRect.height > 0;
	const hasStableScrollMetrics =
		Number.isFinite(scrollTop) &&
		Number.isFinite(viewportHeight) &&
		Number.isFinite(sectionTop);
	return hasStableViewportHeight && hasStableRootRect && hasStableScrollMetrics;
}

export interface ResolveVirtualListLayoutStabilityParams {
	rootEl: HTMLElement;
	rootRect: DOMRect;
	measuredWidth?: number | null;
	hasRenderableContent: boolean;
}

export interface VirtualListLayoutStability {
	rawContainerWidth: number;
	hasStableWidth: boolean;
	hasStableRootRect: boolean;
	isStable: boolean;
}

export function resolveVirtualListLayoutStability({
	rootEl,
	rootRect,
	measuredWidth,
	hasRenderableContent,
}: ResolveVirtualListLayoutStabilityParams): VirtualListLayoutStability {
	const rawContainerWidth = measuredWidth ?? rootRect.width ?? rootEl.clientWidth;
	const hasStableWidth =
		Number.isFinite(rawContainerWidth) &&
		(rawContainerWidth > 0 || rootEl.clientWidth > 0);
	const hasStableRootRect =
		isFiniteRect(rootRect) && (!hasRenderableContent || rootRect.height > 0);

	return {
		rawContainerWidth,
		hasStableWidth,
		hasStableRootRect,
		isStable: !hasRenderableContent || (hasStableWidth && hasStableRootRect),
	};
}

export interface IsStableCachedVirtualListMeasurementParams {
	hasRenderableContent: boolean;
	hasStableCachedScrollMetrics: boolean;
	cachedViewportHeight: number;
	scrollSnapshot: VirtualListScrollSnapshot;
	cachedSectionTop: number;
}

export function isStableCachedVirtualListMeasurementFromMetrics(
	hasRenderableContent: boolean,
	hasStableCachedScrollMetrics: boolean,
	cachedViewportHeight: number,
	scrollTop: number,
	viewportHeight: number,
	cachedSectionTop: number,
): boolean {
	if (!hasRenderableContent) {
		return true;
	}
	const hasStableViewportHeight = viewportHeight > 0;
	return (
		hasStableCachedScrollMetrics &&
		cachedViewportHeight > 0 &&
		hasStableViewportHeight &&
		Number.isFinite(scrollTop) &&
		Number.isFinite(viewportHeight) &&
		Number.isFinite(cachedSectionTop)
	);
}

export function isStableCachedVirtualListMeasurement({
	hasRenderableContent,
	hasStableCachedScrollMetrics,
	cachedViewportHeight,
	scrollSnapshot,
	cachedSectionTop,
}: IsStableCachedVirtualListMeasurementParams): boolean {
	return isStableCachedVirtualListMeasurementFromMetrics(
		hasRenderableContent,
		hasStableCachedScrollMetrics,
		cachedViewportHeight,
		scrollSnapshot.scrollTop,
		scrollSnapshot.viewportHeight,
		cachedSectionTop,
	);
}
