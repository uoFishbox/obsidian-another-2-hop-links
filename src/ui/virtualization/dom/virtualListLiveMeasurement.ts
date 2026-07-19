import { getScrollMetrics } from "./virtualListMeasurementAdapter";
import { isStableVirtualListMeasurement } from "./virtualListMeasurementStability";

export interface VirtualListLiveMeasurementInput {
	rootEl: HTMLElement;
	scrollContainerEl: HTMLElement | null;
	sectionRect?: DOMRect;
	hasRenderableContent: boolean;
}

export interface VirtualListLiveMeasurementResult {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	sectionRect: DOMRect;
	isStableMeasurement: boolean;
}

export function readVirtualListLiveMeasurement({
	rootEl,
	scrollContainerEl,
	sectionRect,
	hasRenderableContent,
}: VirtualListLiveMeasurementInput): VirtualListLiveMeasurementResult {
	const resolvedSectionRect = sectionRect ?? rootEl.getBoundingClientRect();
	const scrollMetrics = getScrollMetrics(
		rootEl,
		scrollContainerEl,
		resolvedSectionRect,
	);
	const isStableMeasurement = isStableVirtualListMeasurement({
		hasRenderableContent,
		rootRect: resolvedSectionRect,
		viewportHeight: scrollMetrics.viewportHeight,
		scrollTop: scrollMetrics.scrollTop,
		sectionTop: scrollMetrics.sectionTop,
	});

	return {
		scrollTop: scrollMetrics.scrollTop,
		viewportHeight: scrollMetrics.viewportHeight,
		sectionTop: scrollMetrics.sectionTop,
		sectionRect: resolvedSectionRect,
		isStableMeasurement,
	};
}
