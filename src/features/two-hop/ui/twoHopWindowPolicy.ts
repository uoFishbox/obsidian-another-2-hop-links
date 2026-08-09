import {
	resolveProgressivePreviewRangeInto,
	resolveProgressiveResidentRangeInto,
} from "features/two-hop/ui/progressivePreviewRange";
import type {
	TwoHopGeometry,
	TwoHopRowRange,
} from "features/two-hop/ui/viewport/twoHopGeometry";

export interface TwoHopScrollCoverage {
	readonly min: number;
	readonly max: number;
}

export interface TwoHopWindowSnapshot {
	readonly active: Readonly<TwoHopRowRange>;
	readonly prepared: Readonly<TwoHopRowRange>;
	readonly coverage: TwoHopScrollCoverage | null;
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
const MAX_COVERAGE_EXPANSIONS = 32;
const COVERAGE_BINARY_SEARCH_STEPS = 14;

export const EMPTY_TWO_HOP_WINDOW: TwoHopWindowSnapshot = Object.freeze({
	active: EMPTY_RANGE,
	prepared: EMPTY_RANGE,
	coverage: null,
});

/** Resolves all scroll-derived two-hop preview state as one immutable value. */
export function resolveTwoHopWindow(
	input: ResolveTwoHopWindowInput,
): TwoHopWindowSnapshot {
	const ranges = resolveRanges(input, input.scrollTop);
	const active = freezeRange(ranges.active);
	const prepared = freezeRange(ranges.prepared);
	const coverage = resolveCoverage(input, active, prepared);
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

export function isScrollTopCovered(
	coverage: TwoHopScrollCoverage | null,
	scrollTop: number,
): boolean {
	return Boolean(coverage && scrollTop > coverage.min && scrollTop < coverage.max);
}

function resolveRanges(
	input: ResolveTwoHopWindowInput,
	scrollTop: number,
): { active: TwoHopRowRange; prepared: TwoHopRowRange } {
	const active: TwoHopRowRange = { start: 0, end: 0 };
	resolveProgressivePreviewRangeInto(
		active,
		input.geometry,
		scrollTop - input.contentTopInScrollSpace,
		input.viewportHeight,
		input.mountedRowEnd,
		input.offscreenBootstrapRows,
	);

	if (!input.previewEnabled) {
		return { active, prepared: { start: 0, end: 0 } };
	}

	const prepared: TwoHopRowRange = { start: 0, end: 0 };
	resolveProgressiveResidentRangeInto(
		prepared,
		active,
		input.previous?.prepared ?? EMPTY_RANGE,
		input.mountedRowEnd,
	);
	return { active, prepared };
}

function resolveCoverage(
	input: ResolveTwoHopWindowInput,
	active: Readonly<TwoHopRowRange>,
	prepared: Readonly<TwoHopRowRange>,
): TwoHopScrollCoverage | null {
	if (input.viewportHeight <= 0 || input.geometry.rowCount === 0) return null;

	const matches = (scrollTop: number): boolean => {
		const candidate = resolveRanges(input, scrollTop);
		return (
			isSameRange(candidate.active, active) &&
			isSameRange(candidate.prepared, prepared)
		);
	};
	const initialStep = Math.max(1, input.geometry.rowStride / 2);
	return {
		min: findCoverageBoundary(input.scrollTop, -1, initialStep, matches),
		max: findCoverageBoundary(input.scrollTop, 1, initialStep, matches),
	};
}

function findCoverageBoundary(
	origin: number,
	direction: -1 | 1,
	initialStep: number,
	matches: (scrollTop: number) => boolean,
): number {
	let matching = origin;
	let step = initialStep;
	for (let index = 0; index < MAX_COVERAGE_EXPANSIONS; index += 1) {
		const candidate = origin + direction * step;
		if (matches(candidate)) {
			matching = candidate;
			step *= 2;
			continue;
		}
		return bisectCoverageBoundary(matching, candidate, matches);
	}
	return direction < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
}

function bisectCoverageBoundary(
	matching: number,
	nonMatching: number,
	matches: (scrollTop: number) => boolean,
): number {
	let inside = matching;
	let outside = nonMatching;
	for (let index = 0; index < COVERAGE_BINARY_SEARCH_STEPS; index += 1) {
		const middle = (inside + outside) / 2;
		if (matches(middle)) inside = middle;
		else outside = middle;
	}
	return outside;
}

function freezeRange(range: TwoHopRowRange): Readonly<TwoHopRowRange> {
	return Object.freeze({ start: range.start, end: range.end });
}

function isSameRange(
	left: Readonly<TwoHopRowRange>,
	right: Readonly<TwoHopRowRange>,
): boolean {
	return left.start === right.start && left.end === right.end;
}
