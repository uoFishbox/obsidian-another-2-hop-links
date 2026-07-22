let measurementEpoch = 0;

/** Advances the generation whenever virtual scroll measurement work runs. */
export function markVirtualScrollMeasurementRun(): void {
	measurementEpoch += 1;
}

/** Returns the generation of the latest virtual scroll measurement. */
export function readVirtualScrollMeasurementEpoch(): number {
	return measurementEpoch;
}

/**
 * Reports whether preview activation should yield to measurement work that ran
 * since its partition last drained.
 */
export function shouldDeferPreviewActivationForVirtualScrollMeasurement(
	previouslyObservedEpoch: number,
): boolean {
	return measurementEpoch !== previouslyObservedEpoch;
}

export function resetVirtualScrollMeasurementFrameForTests(): void {
	measurementEpoch = 0;
}
