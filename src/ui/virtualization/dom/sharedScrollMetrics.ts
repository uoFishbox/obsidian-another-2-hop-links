import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";

export interface VirtualListSharedScrollMetrics {
	scrollTop: number;
	viewportHeight: number;
	frameId: number;
	isScrollActive: boolean;
	/** Monotonic observer-owned generation of the latest native scroll event. */
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
