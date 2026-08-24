import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";

export interface VirtualListScrollMetrics {
	sectionRect: DOMRect;
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
}

export interface VirtualListScrollSnapshot {
	scrollTop: number;
	viewportHeight: number;
}

/** Geometry captured before a programmatic virtual-list scroll write. */
export interface ProgrammaticScrollSnapshot {
	readonly scrollContainerEl: HTMLElement | null;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly didScroll: boolean;
}

export type MeasurementUpdateResult<TRange> =
	| { kind: "stable"; range: TRange; updateKind?: "reused" | "recomputed" }
	| { kind: "bootstrapped"; range: TRange; updateKind?: "reused" | "recomputed" }
	| {
			kind: "skipped";
			reason: "no-window" | "no-root" | "unstable";
			updateKind?: "skipped";
	  };

export function readScrollSnapshot(
	scrollContainer: HTMLElement | null,
	viewportHeightOverride?: number,
	out: VirtualListScrollSnapshot = {
		scrollTop: 0,
		viewportHeight: 0,
	},
	ownerElement?: HTMLElement | null,
): VirtualListScrollSnapshot {
	const ownerWindow = getOptionalOwnerWindow(scrollContainer ?? ownerElement);
	if (!ownerWindow) {
		out.scrollTop = 0;
		out.viewportHeight = 0;
		return out;
	}

	if (scrollContainer) {
		out.scrollTop = scrollContainer.scrollTop;
		out.viewportHeight = viewportHeightOverride ?? scrollContainer.clientHeight;
		return out;
	}

	out.scrollTop = ownerWindow.scrollY || ownerWindow.pageYOffset || 0;
	out.viewportHeight = ownerWindow.innerHeight;
	return out;
}

export const getScrollMetrics = (
	element: HTMLElement,
	scrollContainer: HTMLElement | null,
	sectionRect: DOMRect = element.getBoundingClientRect(),
): VirtualListScrollMetrics => {
	const scrollSnapshot = readScrollSnapshot(
		scrollContainer,
		undefined,
		undefined,
		element,
	);

	if (scrollContainer) {
		const rootRect = scrollContainer.getBoundingClientRect();
		return {
			sectionRect,
			scrollTop: scrollSnapshot.scrollTop,
			viewportHeight: scrollSnapshot.viewportHeight,
			sectionTop: sectionRect.top - rootRect.top + scrollSnapshot.scrollTop,
		};
	}

	return {
		sectionRect,
		scrollTop: scrollSnapshot.scrollTop,
		viewportHeight: scrollSnapshot.viewportHeight,
		sectionTop: sectionRect.top + scrollSnapshot.scrollTop,
	};
};

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

export interface VirtualListSharedScrollMetrics {
	scrollTop: number;
	viewportHeight: number;
	frameId: number;
	isScrollActive: boolean;
	/** Monotonic scroll-target generation of the latest native scroll event. */
	scrollGeneration: number;
}

export interface SharedScrollMetricsSubscriber {
	readonly isDisposed: boolean;
	getCachedViewportHeight?: () => number | undefined;
}

export interface ReadVirtualListSharedScrollMetricsParams {
	scroller: HTMLElement | null;
	subscriber?: SharedScrollMetricsSubscriber | null;
	ownerElement?: HTMLElement | null;
	isScrollActive: boolean;
	frameId: number;
	/** Observer generation captured with these metrics. */
	scrollGeneration: number;
}

export function resolveCachedViewportHeight(
	subscriber: SharedScrollMetricsSubscriber | null | undefined,
): number | null {
	if (!subscriber || subscriber.isDisposed) {
		return null;
	}

	const viewportHeight = subscriber.getCachedViewportHeight?.();
	if (
		viewportHeight === undefined ||
		!Number.isFinite(viewportHeight) ||
		viewportHeight <= 0
	) {
		return null;
	}

	return viewportHeight;
}

export function readVirtualListSharedScrollMetricsInto(
	out: VirtualListSharedScrollMetrics,
	params: ReadVirtualListSharedScrollMetricsParams,
): VirtualListSharedScrollMetrics {
	if (params.scroller) {
		const cachedViewportHeight = resolveCachedViewportHeight(params.subscriber);
		out.scrollTop = params.scroller.scrollTop;
		out.viewportHeight = cachedViewportHeight ?? params.scroller.clientHeight;
		out.frameId = params.frameId;
		out.isScrollActive = params.isScrollActive;
		out.scrollGeneration = params.scrollGeneration;
		return out;
	}

	const ownerWindow = getOptionalOwnerWindow(params.ownerElement);
	out.scrollTop = ownerWindow
		? ownerWindow.scrollY || ownerWindow.pageYOffset || 0
		: 0;
	out.viewportHeight = ownerWindow?.innerHeight ?? 0;
	out.frameId = params.frameId;
	out.isScrollActive = params.isScrollActive;
	out.scrollGeneration = params.scrollGeneration;
	return out;
}
