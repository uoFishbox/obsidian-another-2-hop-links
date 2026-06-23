import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";

export interface VirtualListSharedScrollMetrics {
	scrollTop: number;
	viewportHeight: number;
	frameId: number;
	isScrollActive: boolean;
}

export interface SharedScrollMetricsSubscriber {
	readonly isDisposed: boolean;
	getCachedViewportHeight?: () => number | undefined;
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

export function readVirtualListSharedScrollMetrics(params: {
	scroller: HTMLElement | null;
	subscriber?: SharedScrollMetricsSubscriber | null;
	ownerElement?: HTMLElement | null;
	isScrollActive: boolean;
	frameId: number;
}): VirtualListSharedScrollMetrics {
	if (params.scroller) {
		const cachedViewportHeight = resolveCachedViewportHeight(params.subscriber);
		return {
			scrollTop: params.scroller.scrollTop,
			viewportHeight: cachedViewportHeight ?? params.scroller.clientHeight,
			frameId: params.frameId,
			isScrollActive: params.isScrollActive,
		};
	}

	const ownerWindow = getOptionalOwnerWindow(params.ownerElement);
	return {
		scrollTop: ownerWindow
			? ownerWindow.scrollY || ownerWindow.pageYOffset || 0
			: 0,
		viewportHeight: ownerWindow?.innerHeight ?? 0,
		frameId: params.frameId,
		isScrollActive: params.isScrollActive,
	};
}
