import {
	registerVirtualViewport,
	type ObserveVirtualViewportOptions,
	type VirtualViewportObservation,
} from "./scrollerRegistry";

export type {
	ObserveVirtualViewportOptions,
	VirtualViewportObservation,
} from "./scrollerRegistry";
export type { ScrollMeasurementRange } from "./scrollCoverageGate";

/**
 * Public DOM facade for observing one virtualized viewport.
 *
 * Subscriber arbitration, scroller migration, and shared observer ownership
 * are private to the registry subsystem.
 */
export function observeVirtualViewport(
	options: ObserveVirtualViewportOptions,
): VirtualViewportObservation {
	return registerVirtualViewport(options);
}
