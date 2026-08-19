import type { VirtualListSharedScrollMetrics } from "./sharedScrollMetrics";

export type VirtualMeasurementSource = "layout" | "scroll";

export interface VirtualMeasurement {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly isStableMeasurement: boolean;
	readonly isScrollActive: boolean;
	/** Observer scroll generation represented by this measurement. */
	readonly scrollGeneration: number;
	readonly source: VirtualMeasurementSource;
	readonly sectionRect?: DOMRect;
	readonly sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export type VirtualMeasurementResult =
	| { readonly kind: "measured"; readonly measurement: VirtualMeasurement }
	| {
			readonly kind: "skipped";
			readonly reason: "no-root" | "no-window" | "unchanged-scroll";
	  };

export type VirtualMeasurementApplicationResult = "stable" | "unstable" | "skipped";

export interface VirtualListStableMeasurementContext {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	isScrollActive: boolean;
	sharedScrollMetrics?: VirtualListSharedScrollMetrics;
}

export type VirtualScrollMeasurementReason =
	| "scroll-coverage-miss"
	| "scroll-idle"
	| "data-change"
	| "post-layout";

export interface RunVirtualScrollMeasurementOptions {
	/**
	 * Publish even when the cached scroll geometry matches the last stable
	 * measurement. Use this when non-scroll inputs, such as row data, changed.
	 */
	forcePublish?: boolean;
	/** Dev-only reason for measurement classification. */
	reason?: VirtualScrollMeasurementReason;
}
