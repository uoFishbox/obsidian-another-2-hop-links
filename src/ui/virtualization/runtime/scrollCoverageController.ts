import type {
	MountedScrollWindowMeasurement,
	RangedScrollWindowMeasurement,
	StableScrollTopBand,
} from "../engine/scrollWindowResolver";
import type {
	ScrollMeasurementRange,
	VirtualViewportObservation,
} from "../viewport/observer/observeVirtualViewport";

export interface VirtualScrollCoverageController {
	setObservation(observation: VirtualViewportObservation | null): void;
	clearObservation(observation: VirtualViewportObservation): void;
	setCoverageBand(coverageBand?: StableScrollTopBand): void;
	reset(): void;
	resolvePublishedCoverageBand(
		mountedMeasurement: MountedScrollWindowMeasurement,
		rangedMeasurement: RangedScrollWindowMeasurement,
	): StableScrollTopBand | undefined;
	getMeasurementRange(): ScrollMeasurementRange | null;
	publish(): void;
}

/** Owns the open scroll interval already covered by the published snapshot. */
export function createVirtualScrollCoverageController(): VirtualScrollCoverageController {
	let coverageScrollTopMin = Number.POSITIVE_INFINITY;
	let coverageScrollTopMax = Number.NEGATIVE_INFINITY;
	let observation: VirtualViewportObservation | null = null;
	const measurementRange: {
		-readonly [K in keyof ScrollMeasurementRange]: ScrollMeasurementRange[K];
	} = {
		minScrollTopBeforeMeasurement: 0,
		maxScrollTopBeforeMeasurement: 0,
	};
	const intersectionBand: {
		-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
	} = {
		min: 0,
		max: 0,
	};

	function setObservation(nextObservation: VirtualViewportObservation | null): void {
		observation = nextObservation;
	}

	function clearObservation(previousObservation: VirtualViewportObservation): void {
		if (observation === previousObservation) observation = null;
	}

	function setCoverageBand(coverageBand?: StableScrollTopBand): void {
		coverageScrollTopMin = coverageBand?.min ?? Number.POSITIVE_INFINITY;
		coverageScrollTopMax = coverageBand?.max ?? Number.NEGATIVE_INFINITY;
	}

	function reset(): void {
		setCoverageBand();
	}

	function resolvePublishedCoverageBand(
		mountedMeasurement: MountedScrollWindowMeasurement,
		rangedMeasurement: RangedScrollWindowMeasurement,
	): StableScrollTopBand | undefined {
		const mountedBand = mountedMeasurement.mountedCoverageScrollTopBand;
		const previewBand = rangedMeasurement.previewCoverageScrollTopBand;
		if (
			!mountedBand ||
			!previewBand ||
			mountedMeasurement.identity !== rangedMeasurement.identity ||
			mountedMeasurement.mounted.start !==
				rangedMeasurement.ranges.mounted.start ||
			mountedMeasurement.mounted.end !== rangedMeasurement.ranges.mounted.end ||
			rangedMeasurement.ranges.previewVisible.start <
				rangedMeasurement.ranges.mounted.start ||
			rangedMeasurement.ranges.previewVisible.end >
				rangedMeasurement.ranges.mounted.end
		) {
			return undefined;
		}

		intersectionBand.min = Math.max(mountedBand.min, previewBand.min);
		intersectionBand.max = Math.min(mountedBand.max, previewBand.max);
		return intersectionBand.min < intersectionBand.max
			? intersectionBand
			: undefined;
	}

	function getMeasurementRange(): ScrollMeasurementRange | null {
		if (!(coverageScrollTopMin < coverageScrollTopMax)) return null;

		measurementRange.minScrollTopBeforeMeasurement = coverageScrollTopMin;
		measurementRange.maxScrollTopBeforeMeasurement = coverageScrollTopMax;
		return measurementRange;
	}

	function publish(): void {
		observation?.publishScrollMeasurementRange(getMeasurementRange());
	}

	return {
		setObservation,
		clearObservation,
		setCoverageBand,
		reset,
		resolvePublishedCoverageBand,
		getMeasurementRange,
		publish,
	};
}
