/** Open scrollTop interval in which another scroll measurement is unnecessary. */
export interface ScrollMeasurementRange {
	readonly minScrollTopBeforeMeasurement: number;
	readonly maxScrollTopBeforeMeasurement: number;
}

export interface ScrollCoverageGate {
	valid: boolean;
	min: number;
	max: number;
}

export function isWithinScrollCoverageGate(
	gate: ScrollCoverageGate,
	scrollTop: number,
): boolean {
	return gate.valid && scrollTop > gate.min && scrollTop < gate.max;
}

export function publishScrollCoverageGate(
	gate: ScrollCoverageGate,
	range: ScrollMeasurementRange | null,
): void {
	if (!range) {
		gate.valid = false;
		return;
	}

	gate.valid = true;
	gate.min = range.minScrollTopBeforeMeasurement;
	gate.max = range.maxScrollTopBeforeMeasurement;
}
