let didRunMeasurement = false;
let resetHandle: number | null = null;
let resetHandleKind: "animation-frame" | "timeout" | null = null;

function scheduleRunMarkerReset(): void {
	if (resetHandle !== null) return;

	if (typeof globalThis.requestAnimationFrame === "function") {
		resetHandleKind = "animation-frame";
		resetHandle = globalThis.requestAnimationFrame(clearRunMarker);
		return;
	}

	if (typeof globalThis.setTimeout !== "function") return;
	resetHandleKind = "timeout";
	resetHandle = globalThis.setTimeout(clearRunMarker, 0) as unknown as number;
}

function clearRunMarker(): void {
	resetHandle = null;
	resetHandleKind = null;
	didRunMeasurement = false;
}

/** Records that virtual scroll measurement work ran in the current frame. */
export function markVirtualScrollMeasurementRun(): void {
	didRunMeasurement = true;
	scheduleRunMarkerReset();
}

/**
 * Reports whether preview activation should yield to current-frame virtual
 * scroll measurement work.
 */
export function shouldDeferPreviewActivationForVirtualScrollMeasurement(): boolean {
	return didRunMeasurement;
}

export function resetVirtualScrollMeasurementFrameForTests(): void {
	if (resetHandle !== null) {
		if (
			resetHandleKind === "animation-frame" &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(resetHandle);
		} else if (typeof globalThis.clearTimeout === "function") {
			globalThis.clearTimeout(resetHandle);
		}
	}

	didRunMeasurement = false;
	resetHandle = null;
	resetHandleKind = null;
}
