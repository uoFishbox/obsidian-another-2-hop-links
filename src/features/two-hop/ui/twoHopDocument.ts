import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import {
	createSectionVisibleCountsController,
	type SectionPaginationApplicationStore,
} from "ui/virtualization/pagination";
import { buildScopedSectionId } from "ui/components/common/listPagination";
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
	readonly header: TwoHopHeaderNode;
	readonly visibleItemCount: number;
	readonly totalItemCount: number;
	getItem(visibleIndex: number): TwoHopDocumentItem | undefined;
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
	/** Reuses unchanged document sections across projections. */
	readonly previousDocument?: TwoHopDocument;
	readonly paginationScope?: string;
}

export interface TwoHopDocumentProjectionParams {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly applicationStore?: SectionPaginationApplicationStore;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationScope?: string;
}

export interface TwoHopDocumentProjectionInput {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly paginationScope: string;
	readonly initialVisibleCount: number | undefined;
	readonly loadMoreIncrement: number | undefined;
}

export interface TwoHopDocumentProjection {
	getDocument(): TwoHopDocument;
	setInput(input: TwoHopDocumentProjectionInput): TwoHopDocument;
	loadMore(sectionId: string): TwoHopDocument | null;
}

/** Owns search/sort source identity and pagination as one document projection. */
export function createTwoHopDocumentProjection(
	params: TwoHopDocumentProjectionParams,
): TwoHopDocumentProjection {
	const createPagination = (
		scope: string,
		initialVisibleCount: number | undefined,
		loadMoreIncrement: number | undefined,
	) =>
		createSectionVisibleCountsController<
			TwoHopVirtualListItem,
			TwoHopVirtualSectionDescriptor["section"]
		>({
			applicationStore: params.applicationStore,
			initialVisibleCount,
			loadMoreIncrement,
			resolvePaginationKey: (section) =>
				buildScopedSectionId(section.sectionId, scope),
		});
	let sources = params.sections;
	let paginationScope = params.paginationScope?.trim() ?? "";
	let initialVisibleCount = params.initialVisibleCount;
	let loadMoreIncrement = params.loadMoreIncrement;
	let pagination = createPagination(
		paginationScope,
		initialVisibleCount,
		loadMoreIncrement,
	);
	let revisionValue = 0;
	let document = project();

	function project(previousDocument?: TwoHopDocument): TwoHopDocument {
		const visibleCounts =
			pagination.resolveForInput(sources).snapshot.visibleCounts;
		const nextDocument = createTwoHopDocument({
			sections: sources,
			visibleCounts,
			initialVisibleCount: initialVisibleCount ?? Number.POSITIVE_INFINITY,
			paginationScope,
			previousDocument,
			revision: createDocumentRevision(++revisionValue),
		});
		if (
			previousDocument &&
			hasSameDocumentSectionRefs(previousDocument.sections, nextDocument.sections)
		) {
			return previousDocument;
		}
		return nextDocument;
	}

	return {
		getDocument: () => document,
		setInput(input) {
			const nextScope = input.paginationScope.trim();
			const scopeChanged = paginationScope !== nextScope;
			const paginationOptionsChanged =
				!Object.is(initialVisibleCount, input.initialVisibleCount) ||
				!Object.is(loadMoreIncrement, input.loadMoreIncrement);
			if (
				!scopeChanged &&
				!paginationOptionsChanged &&
				hasSameSectionPublications(sources, input.sections)
			) {
				sources = input.sections;
				return document;
			}
			sources = input.sections;
			if (scopeChanged || paginationOptionsChanged) {
				paginationScope = nextScope;
				initialVisibleCount = input.initialVisibleCount;
				loadMoreIncrement = input.loadMoreIncrement;
				pagination = createPagination(
					paginationScope,
					initialVisibleCount,
					loadMoreIncrement,
				);
			}
			document = project(document);
			return document;
		},
		loadMore(sectionId) {
			const source = sources.find((section) => section.sectionId === sectionId);
			if (!source) return null;
			const result = pagination.loadMore(
				buildScopedSectionId(source.sectionId, paginationScope),
				source.loadedCount,
			);
			if (!result.changed) return null;
			document = project(document);
			return document;
		},
	};
}

function hasSameDocumentSectionRefs(
	current: readonly TwoHopDocumentSection[],
	next: readonly TwoHopDocumentSection[],
): boolean {
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (current[index] !== next[index]) return false;
	}
	return true;
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
		const paginationKey = buildScopedSectionId(
			descriptor.sectionId,
			params.paginationScope,
		);
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
		previousSection.visibleItemCount === visibleSourceCount
	) {
		return previousSection;
	}

	const section: TwoHopDocumentSection = Object.freeze({
		key: descriptor.sectionId,
		sourceRevision: descriptor.sourceRevision,
		header: Object.freeze({
			kind: "header",
			logicalKey: `header:${descriptor.sectionId}`,
			sectionId: descriptor.sectionId,
			section: descriptor.section,
			props: descriptor.headerProps,
		}),
		visibleItemCount: visibleSourceCount,
		totalItemCount: descriptor.totalCount,
		getItem(visibleIndex: number): TwoHopDocumentItem | undefined {
			return descriptor.getItem(visibleIndex);
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

function clampVisibleCount(
	descriptor: TwoHopVirtualSectionDescriptor,
	count: number,
): number {
	if (!Number.isFinite(count)) return descriptor.loadedCount;
	return Math.min(descriptor.loadedCount, Math.max(0, Math.floor(count)));
}
