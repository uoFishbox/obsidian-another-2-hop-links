import {
	resolveProgressivePreviewWindowInto,
	resolveProgressiveResidentRangeInto,
} from "features/two-hop/ui/progressivePreviewRange";
import type {
	TwoHopGeometry,
	TwoHopRowRange,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import type {
	MutableStableScrollTopBand,
	ScrollMeasurementRange,
	StableScrollTopBand,
} from "ui/virtualization/core/scrollWindowGate";

export interface TwoHopWindowSnapshot {
	readonly active: Readonly<TwoHopRowRange>;
	readonly prepared: Readonly<TwoHopRowRange>;
	readonly coverage: ScrollMeasurementRange | null;
}

export interface ResolveTwoHopWindowInput {
	readonly geometry: TwoHopGeometry;
	readonly mountedRowEnd: number;
	readonly scrollTop: number;
	readonly contentTopInScrollSpace: number;
	readonly viewportHeight: number;
	readonly offscreenBootstrapRows: number;
	readonly previewEnabled: boolean;
	readonly previous: TwoHopWindowSnapshot | null;
}

const EMPTY_RANGE = Object.freeze({ start: 0, end: 0 });
export const EMPTY_TWO_HOP_WINDOW: TwoHopWindowSnapshot = Object.freeze({
	active: EMPTY_RANGE,
	prepared: EMPTY_RANGE,
	coverage: null,
});

/** Resolves all scroll-derived two-hop preview state as one immutable value. */
export function resolveTwoHopWindow(
	input: ResolveTwoHopWindowInput,
): TwoHopWindowSnapshot {
	const active: TwoHopRowRange = { start: 0, end: 0 };
	const stableBand: MutableStableScrollTopBand = { min: 0, max: 0 };
	resolveProgressivePreviewWindowInto(
		active,
		stableBand,
		input.geometry,
		input.scrollTop - input.contentTopInScrollSpace,
		input.viewportHeight,
		input.mountedRowEnd,
		input.offscreenBootstrapRows,
	);

	const prepared: TwoHopRowRange = { start: 0, end: 0 };
	if (input.previewEnabled) {
		resolveProgressiveResidentRangeInto(
			prepared,
			active,
			input.previous?.prepared ?? EMPTY_RANGE,
			input.mountedRowEnd,
		);
	}
	const coverage =
		input.viewportHeight > 0 && input.geometry.rowCount > 0
			? resolveScrollMeasurementRange(stableBand, input.contentTopInScrollSpace)
			: null;
	Object.freeze(active);
	Object.freeze(prepared);
	return Object.freeze({ active, prepared, coverage });
}

export function isSameTwoHopWindow(
	left: TwoHopWindowSnapshot,
	right: TwoHopWindowSnapshot,
): boolean {
	return (
		isSameRange(left.active, right.active) &&
		isSameRange(left.prepared, right.prepared)
	);
}

function resolveScrollMeasurementRange(
	stableBand: StableScrollTopBand,
	contentTopInScrollSpace: number,
): ScrollMeasurementRange | null {
	if (stableBand.min >= stableBand.max) return null;
	return {
		minScrollTopBeforeMeasurement: stableBand.min + contentTopInScrollSpace,
		maxScrollTopBeforeMeasurement: stableBand.max + contentTopInScrollSpace,
	};
}

function isSameRange(
	left: Readonly<TwoHopRowRange>,
	right: Readonly<TwoHopRowRange>,
): boolean {
	return left.start === right.start && left.end === right.end;
}
