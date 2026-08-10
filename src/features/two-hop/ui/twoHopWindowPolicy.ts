import {
	resolveTwoHopVisibleWindowInto,
	type TwoHopGeometry,
	type TwoHopRowRange,
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

const PREVIEW_RESIDENT_OVERSCAN_ROWS = 2;
const PREVIEW_RESIDENT_GUARD_ROWS = 1;

/**
 * Resolves the mounted preview window and its open stable scroll interval.
 * The window includes one row of logical overscan.
 * An optional prefix can remain active while the entire content starts below
 * the viewport so its previews can be prepared before the first downward scroll.
 */
export function resolveProgressivePreviewWindowInto(
	rangeTarget: TwoHopRowRange,
	stableBandTarget: MutableStableScrollTopBand,
	geometry: TwoHopGeometry,
	localViewportTop: number,
	viewportHeight: number,
	mountedRowEnd: number,
	offscreenBootstrapRows = 0,
): void {
	const mountedEnd = Math.min(
		geometry.rowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	const bootstrapRowCount = Math.min(
		mountedEnd,
		Math.max(0, Math.floor(offscreenBootstrapRows)),
	);
	const contentStartsBelowViewport =
		viewportHeight > 0 && localViewportTop <= -viewportHeight;
	if (contentStartsBelowViewport && bootstrapRowCount > 0) {
		rangeTarget.start = 0;
		rangeTarget.end = bootstrapRowCount;
		stableBandTarget.min = Number.NEGATIVE_INFINITY;
		stableBandTarget.max = -viewportHeight;
		return;
	}
	if (mountedEnd === 0 && viewportHeight > 0 && geometry.rowCount > 0) {
		rangeTarget.start = 0;
		rangeTarget.end = 0;
		stableBandTarget.min = Number.NEGATIVE_INFINITY;
		stableBandTarget.max = Number.POSITIVE_INFINITY;
		return;
	}

	const overscan = geometry.rowStride;
	resolveTwoHopVisibleWindowInto(
		rangeTarget,
		stableBandTarget,
		geometry,
		localViewportTop - overscan,
		viewportHeight + overscan * 2,
	);

	rangeTarget.end = Math.min(rangeTarget.end, mountedEnd);
	rangeTarget.start = Math.min(rangeTarget.start, rangeTarget.end);
	stableBandTarget.min += overscan;
	stableBandTarget.max += overscan;
	if (bootstrapRowCount > 0) {
		stableBandTarget.min = Math.max(stableBandTarget.min, -viewportHeight);
	}
}

/** Resolves a bounded host range and preserves it while active rows remain in its guard area. */
export function resolveProgressiveResidentRangeInto(
	target: TwoHopRowRange,
	activeRange: TwoHopRowRange,
	currentResidentRange: TwoHopRowRange,
	mountedRowEnd: number,
): void {
	const mountedEnd = Math.max(0, Math.floor(mountedRowEnd));
	if (activeRange.end <= activeRange.start || mountedEnd === 0) {
		target.start = 0;
		target.end = 0;
		return;
	}

	const activeStart = Math.min(Math.max(0, activeRange.start), mountedEnd);
	const activeEnd = Math.min(Math.max(activeStart, activeRange.end), mountedEnd);
	if (activeEnd <= activeStart) {
		target.start = 0;
		target.end = 0;
		return;
	}
	const residentStart = Math.min(Math.max(0, currentResidentRange.start), mountedEnd);
	const residentEnd = Math.min(
		Math.max(residentStart, currentResidentRange.end),
		mountedEnd,
	);
	const guardedStart =
		residentStart === 0
			? residentStart
			: residentStart + PREVIEW_RESIDENT_GUARD_ROWS;
	const guardedEnd =
		residentEnd === mountedEnd
			? residentEnd
			: residentEnd - PREVIEW_RESIDENT_GUARD_ROWS;
	const activeFitsGuardArea = activeStart >= guardedStart && activeEnd <= guardedEnd;

	if (activeFitsGuardArea) {
		target.start = residentStart;
		target.end = residentEnd;
		return;
	}

	target.start = Math.max(0, activeStart - PREVIEW_RESIDENT_OVERSCAN_ROWS);
	target.end = Math.min(mountedEnd, activeEnd + PREVIEW_RESIDENT_OVERSCAN_ROWS);
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
