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

export function readVirtualListCachedMeasurementInto(
	out: VirtualListCachedMeasurementResult,
	{
		rootEl,
		scrollContainerEl,
		viewportHeight,
		sectionTop,
		hasStableScrollMetrics,
		hasRenderableContent,
		cachedScrollSnapshot,
		sharedScrollMetrics,
	}: VirtualListCachedMeasurementInput,
): VirtualListCachedMeasurementResult {
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

	out.scrollTop = scrollTop;
	out.viewportHeight = resolvedViewportHeight;
	out.sectionTop = sectionTop;
	out.isScrollActive = sharedScrollMetrics?.isScrollActive ?? false;
	out.isStableMeasurement = isStableCachedVirtualListMeasurementFromMetrics(
		hasRenderableContent,
		hasStableScrollMetrics,
		viewportHeight,
		scrollTop,
		resolvedViewportHeight,
		sectionTop,
	);
	out.sharedScrollMetrics = sharedScrollMetrics;
	return out;
}

export function readVirtualListCachedMeasurement(
	input: VirtualListCachedMeasurementInput,
): VirtualListCachedMeasurementResult {
	return readVirtualListCachedMeasurementInto(
		{
			scrollTop: 0,
			viewportHeight: 0,
			sectionTop: 0,
			isScrollActive: false,
			isStableMeasurement: false,
		},
		input,
	);
}
