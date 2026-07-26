import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import {
	createSectionVisibleCountsController,
	getSectionPaginationKey,
	type SectionPaginationApplicationStore,
} from "ui/virtualization/pagination";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createDocumentRevision,
	type DocumentRevision,
	type SectionDataRevision,
} from "features/two-hop/ui/twoHopRevisions";

let nextStandaloneDocumentRevision = 1;

export type TwoHopDocumentItem = TwoHopVirtualListItem;

export interface TwoHopHeaderNode {
	readonly kind: "header";
	readonly logicalKey: string;
	readonly sectionId: string;
	readonly section: TwoHopVirtualListSection;
	readonly props: ClickableHeaderExtraProps;
}

export interface TwoHopLoadMoreNode {
	readonly kind: "load-more";
	readonly logicalKey: string;
	readonly sectionId: string;
}

export interface TwoHopDocumentSection {
	readonly key: string;
	readonly sourceRevision: SectionDataRevision;
	readonly projectedSourceCount: number;
	readonly header: TwoHopHeaderNode;
	readonly visibleItemCount: number;
	readonly totalItemCount: number;
	readonly visibleSourceIndexes: Uint32Array;
	getItem(visibleIndex: number): TwoHopDocumentItem;
	readonly loadMore: TwoHopLoadMoreNode | null;
}

export interface TwoHopDocument {
	readonly revision: DocumentRevision;
	readonly sections: readonly TwoHopDocumentSection[];
}

export interface CreateTwoHopDocumentParams {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly visibleCounts: Readonly<Record<string, number>>;
	readonly initialVisibleCount: number;
	readonly revision?: DocumentRevision;
	/** Reuses only the projection index map when a section is expanded. */
	readonly previousDocument?: TwoHopDocument;
}

export interface TwoHopDocumentProjectionParams {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore?: SectionPaginationApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
}

export interface TwoHopDocumentProjection {
	getDocument(): TwoHopDocument;
	setSections(sections: readonly TwoHopVirtualSectionDescriptor[]): TwoHopDocument;
	loadMore(sectionId: string): TwoHopDocument | null;
}

/** Owns search/sort source identity and pagination as one document projection. */
export function createTwoHopDocumentProjection(
	params: TwoHopDocumentProjectionParams,
): TwoHopDocumentProjection {
	const pagination = createSectionVisibleCountsController<
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor["section"]
	>({
		applicationStore: params.applicationStore,
		initialVisibleCount: params.initialVisibleCount,
		loadMoreIncrement: params.loadMoreIncrement,
	});
	const initialVisibleCount = params.initialVisibleCount ?? Number.POSITIVE_INFINITY;
	let sources = params.sections;
	let revisionValue = 0;
	let document = project();

	function project(previousDocument?: TwoHopDocument): TwoHopDocument {
		const visibleCounts =
			pagination.resolveForInput(sources).snapshot.visibleCounts;
		return createTwoHopDocument({
			sections: sources,
			visibleCounts,
			initialVisibleCount,
			previousDocument,
			revision: createDocumentRevision(++revisionValue),
		});
	}

	return {
		getDocument: () => document,
		setSections(nextSections) {
			if (hasSameSectionPublications(sources, nextSections)) {
				sources = nextSections;
				return document;
			}
			sources = nextSections;
			document = project(document);
			return document;
		},
		loadMore(sectionId) {
			const source = sources.find((section) => section.sectionId === sectionId);
			if (!source) return null;
			const result = pagination.loadMore(
				getSectionPaginationKey(source),
				source.loadedCount,
			);
			if (!result.changed) return null;
			document = project(document);
			return document;
		},
	};
}

/**
 * Projects searched, sorted, and paginated section sources into the logical
 * document consumed by layout and rendering. Items stay owned by their source;
 * the projection retains only the sparse visible-to-source index map.
 */
export function createTwoHopDocument(
	params: CreateTwoHopDocumentParams,
): TwoHopDocument {
	const previousSections = new Map(
		(params.previousDocument?.sections ?? []).map(
			(section) => [section.key, section] as const,
		),
	);
	const sections = params.sections.map((descriptor) => {
		const paginationKey = getSectionPaginationKey(descriptor);
		const requestedVisibleCount =
			params.visibleCounts[paginationKey] ?? params.initialVisibleCount;
		const visibleSourceCount = clampVisibleCount(descriptor, requestedVisibleCount);
		const previousSection = previousSections.get(descriptor.sectionId);
		return createDocumentSection(descriptor, visibleSourceCount, previousSection);
	});

	return Object.freeze({
		revision:
			params.revision ?? createDocumentRevision(nextStandaloneDocumentRevision++),
		sections: Object.freeze(sections),
	});
}

function hasSameSectionPublications(
	current: readonly TwoHopVirtualSectionDescriptor[],
	next: readonly TwoHopVirtualSectionDescriptor[],
): boolean {
	if (current === next) return true;
	if (current.length !== next.length) return false;

	for (let index = 0; index < current.length; index += 1) {
		const currentSection = current[index];
		const nextSection = next[index];
		if (
			currentSection.sectionId !== nextSection.sectionId ||
			currentSection.sourceRevision !== nextSection.sourceRevision
		) {
			return false;
		}
	}
	return true;
}

function createDocumentSection(
	descriptor: TwoHopVirtualSectionDescriptor,
	visibleSourceCount: number,
	previousSection: TwoHopDocumentSection | undefined,
): TwoHopDocumentSection {
	if (
		previousSection &&
		previousSection.sourceRevision === descriptor.sourceRevision &&
		previousSection.projectedSourceCount === visibleSourceCount
	) {
		return previousSection;
	}

	const visibleSourceIndexes = projectVisibleSourceIndexes(
		descriptor,
		visibleSourceCount,
		previousSection,
	);
	const section: TwoHopDocumentSection = Object.freeze({
		key: descriptor.sectionId,
		sourceRevision: descriptor.sourceRevision,
		projectedSourceCount: visibleSourceCount,
		header: Object.freeze({
			kind: "header",
			logicalKey: `header:${descriptor.sectionId}`,
			sectionId: descriptor.sectionId,
			section: descriptor.section,
			props: descriptor.headerProps,
		}),
		visibleItemCount: visibleSourceIndexes.length,
		totalItemCount: descriptor.totalCount,
		visibleSourceIndexes,
		getItem(visibleIndex: number): TwoHopDocumentItem {
			const sourceIndex = visibleSourceIndexes[visibleIndex];
			return descriptor.getItem(sourceIndex) as TwoHopDocumentItem;
		},
		loadMore:
			visibleSourceCount < descriptor.loadedCount
				? Object.freeze({
						kind: "load-more",
						logicalKey: `load-more:${descriptor.sectionId}`,
						sectionId: descriptor.sectionId,
					})
				: null,
	});
	return section;
}

function projectVisibleSourceIndexes(
	descriptor: TwoHopVirtualSectionDescriptor,
	visibleSourceCount: number,
	previousSection: TwoHopDocumentSection | undefined,
): Uint32Array {
	const canReusePrevious =
		previousSection?.sourceRevision === descriptor.sourceRevision;
	const sourceIndexes = canReusePrevious
		? Array.from(previousSection.visibleSourceIndexes).filter(
				(sourceIndex) => sourceIndex < visibleSourceCount,
			)
		: [];
	const startSourceIndex = canReusePrevious
		? Math.min(previousSection.projectedSourceCount, visibleSourceCount)
		: 0;

	for (
		let sourceIndex = startSourceIndex;
		sourceIndex < visibleSourceCount;
		sourceIndex += 1
	) {
		if (descriptor.getItem(sourceIndex)) sourceIndexes.push(sourceIndex);
	}

	return Uint32Array.from(sourceIndexes);
}

function clampVisibleCount(
	descriptor: TwoHopVirtualSectionDescriptor,
	count: number,
): number {
	if (!Number.isFinite(count)) return descriptor.loadedCount;
	return Math.min(descriptor.loadedCount, Math.max(0, Math.floor(count)));
}
