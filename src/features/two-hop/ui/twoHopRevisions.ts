import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";

/**
 * Official TwoHop change contracts.
 *
 * Logical keys identify a target, these revisions publish semantic data/layout
 * changes, and ResidentSlotLeaseToken is a captured ownership lease. Object
 * references outside these contracts may only be used as cache fast paths.
 */
export interface DocumentRevision {
	readonly kind: "two-hop-document";
	readonly value: number;
}

export interface SectionDataRevision {
	readonly kind: "two-hop-section-data";
	readonly value: number;
}

export interface LayoutRevision {
	readonly kind: "two-hop-layout";
	readonly value: number;
}

export interface TwoHopLayoutPublication {
	readonly revision: LayoutRevision;
	readonly metrics: ViewPlanLayoutMetrics;
}

/** Identifies one ownership period of a bounded physical render slot. */
export function createDocumentRevision(value: number): DocumentRevision {
	return Object.freeze({ kind: "two-hop-document", value });
}

export function createSectionDataRevision(value: number): SectionDataRevision {
	return Object.freeze({ kind: "two-hop-section-data", value });
}

export function createLayoutPublication(
	metrics: ViewPlanLayoutMetrics,
	value: number,
): TwoHopLayoutPublication {
	return Object.freeze({
		revision: Object.freeze({ kind: "two-hop-layout", value }),
		metrics: Object.freeze({ ...metrics }),
	});
}
