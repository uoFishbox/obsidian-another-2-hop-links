import type { VirtualListSharedScrollMetrics } from "./virtualListDomObserver";
import {
	readScrollSnapshot,
	type VirtualListScrollSnapshot,
} from "./virtualListMeasurementAdapter";
import { isStableCachedVirtualListMeasurementFromMetrics } from "./virtualListMeasurementStability";

export interface VirtualListCachedMeasurementInput {
	rootEl: HTMLElement | null;
	scrollContainerEl: HTMLElement | null;
	viewportHeight: number;
	sectionTop: number;
	hasStableScrollMetrics: boolean;
	hasRenderableContent: boolean;
	cachedScrollSnapshot: VirtualListScrollSnapshot;
	sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export interface VirtualListCachedMeasurementResult {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isScrollActive: boolean;
	isStableMeasurement: boolean;
	sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export function readVirtualListCachedMeasurement({
	rootEl,
	scrollContainerEl,
	viewportHeight,
	sectionTop,
	hasStableScrollMetrics,
	hasRenderableContent,
	cachedScrollSnapshot,
	sharedScrollMetrics,
}: VirtualListCachedMeasurementInput): VirtualListCachedMeasurementResult {
	const snapshot =
		sharedScrollMetrics ??
		readScrollSnapshot(
			scrollContainerEl,
			viewportHeight,
			cachedScrollSnapshot,
			rootEl,
		);
	const scrollTop = snapshot.scrollTop;
	const resolvedViewportHeight = snapshot.viewportHeight;

	return {
		scrollTop,
		viewportHeight: resolvedViewportHeight,
		sectionTop,
		isScrollActive: sharedScrollMetrics?.isScrollActive ?? false,
		isStableMeasurement: isStableCachedVirtualListMeasurementFromMetrics(
			hasRenderableContent,
			hasStableScrollMetrics,
			viewportHeight,
			scrollTop,
			resolvedViewportHeight,
			sectionTop,
		),
		...(sharedScrollMetrics ? { sharedScrollMetrics } : {}),
	};
}
