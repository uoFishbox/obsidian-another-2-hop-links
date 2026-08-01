/**
 * TwoHop document and section publication revisions.
 * Logical keys identify a target, while revisions identify its current data.
 */
export interface DocumentRevision {
	readonly kind: "two-hop-document";
	readonly value: number;
}

export interface SectionDataRevision {
	readonly kind: "two-hop-section-data";
	readonly value: number;
}

export function createDocumentRevision(value: number): DocumentRevision {
	return Object.freeze({ kind: "two-hop-document", value });
}

export function createSectionDataRevision(value: number): SectionDataRevision {
	return Object.freeze({ kind: "two-hop-section-data", value });
}
