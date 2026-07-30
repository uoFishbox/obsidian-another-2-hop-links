import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";

/**
 * Official TwoHop change contracts.
 *
 * Logical keys identify a target. These revisions are source/compiler
 * dependencies and must not be combined by UI consumers to prove currentness;
 * the committed virtual frame publishes that decision as immutable specs.
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
