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
}

/** Caller-owned storage for the independently published measurement gate. */
export interface TwoHopWindowMeasurement {
	measurementRange: ScrollMeasurementRange | null;
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
});

/** Resolves the committed preview window and writes the immediate measurement gate separately. */
export function resolveTwoHopWindow(
	input: ResolveTwoHopWindowInput,
	measurement: TwoHopWindowMeasurement,
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
	writeScrollMeasurementRange(
		measurement,
		stableBand,
		input.contentTopInScrollSpace,
		input.viewportHeight > 0 && input.geometry.rowCount > 0,
	);
	Object.freeze(active);
	Object.freeze(prepared);
	return Object.freeze({ active, prepared });
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

function writeScrollMeasurementRange(
	measurement: TwoHopWindowMeasurement,
	stableBand: StableScrollTopBand,
	contentTopInScrollSpace: number,
	valid: boolean,
): void {
	if (!valid || stableBand.min >= stableBand.max) {
		measurement.measurementRange = null;
		return;
	}
	const range = measurement.measurementRange;
	if (range) {
		(range as MutableScrollMeasurementRange).minScrollTopBeforeMeasurement =
			stableBand.min + contentTopInScrollSpace;
		(range as MutableScrollMeasurementRange).maxScrollTopBeforeMeasurement =
			stableBand.max + contentTopInScrollSpace;
		return;
	}
	measurement.measurementRange = {
		minScrollTopBeforeMeasurement: stableBand.min + contentTopInScrollSpace,
		maxScrollTopBeforeMeasurement: stableBand.max + contentTopInScrollSpace,
	};
}

type MutableScrollMeasurementRange = {
	-readonly [K in keyof ScrollMeasurementRange]: ScrollMeasurementRange[K];
};

function isSameRange(
	left: Readonly<TwoHopRowRange>,
	right: Readonly<TwoHopRowRange>,
): boolean {
	return left.start === right.start && left.end === right.end;
}
