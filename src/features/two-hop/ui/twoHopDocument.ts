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
	readonly header: TwoHopHeaderNode;
	readonly visibleItemCount: number;
	readonly totalItemCount: number;
	readonly visibleSourceIndexes: Uint32Array;
	getItem(visibleIndex: number): TwoHopDocumentItem;
	readonly loadMore: TwoHopLoadMoreNode | null;
}

export interface TwoHopDocument {
	readonly sections: readonly TwoHopDocumentSection[];
}

export interface CreateTwoHopDocumentParams {
	readonly sections: readonly TwoHopVirtualSectionDescriptor[];
	readonly visibleCounts: Readonly<Record<string, number>>;
	readonly initialVisibleCount: number;
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

interface SectionProjectionSource {
	readonly descriptor: TwoHopVirtualSectionDescriptor;
	readonly visibleSourceCount: number;
}

const projectionSourceBySection = new WeakMap<
	TwoHopDocumentSection,
	SectionProjectionSource
>();

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
	let document = project();

	function project(previousDocument?: TwoHopDocument): TwoHopDocument {
		const visibleCounts =
			pagination.resolveForInput(sources).snapshot.visibleCounts;
		return createTwoHopDocument({
			sections: sources,
			visibleCounts,
			initialVisibleCount,
			previousDocument,
		});
	}

	return {
		getDocument: () => document,
		setSections(nextSections) {
			if (sources === nextSections) return document;
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

	return Object.freeze({ sections: Object.freeze(sections) });
}

function createDocumentSection(
	descriptor: TwoHopVirtualSectionDescriptor,
	visibleSourceCount: number,
	previousSection: TwoHopDocumentSection | undefined,
): TwoHopDocumentSection {
	const previousSource = previousSection
		? projectionSourceBySection.get(previousSection)
		: undefined;
	if (
		previousSection &&
		previousSource?.descriptor === descriptor &&
		previousSource.visibleSourceCount === visibleSourceCount
	) {
		return previousSection;
	}

	const visibleSourceIndexes = projectVisibleSourceIndexes(
		descriptor,
		visibleSourceCount,
		previousSection,
		previousSource,
	);
	const section: TwoHopDocumentSection = Object.freeze({
		key: descriptor.sectionId,
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
	projectionSourceBySection.set(section, { descriptor, visibleSourceCount });
	return section;
}

function projectVisibleSourceIndexes(
	descriptor: TwoHopVirtualSectionDescriptor,
	visibleSourceCount: number,
	previousSection: TwoHopDocumentSection | undefined,
	previousSource: SectionProjectionSource | undefined,
): Uint32Array {
	const canReusePrevious =
		previousSection !== undefined && previousSource?.descriptor === descriptor;
	const sourceIndexes = canReusePrevious
		? Array.from(previousSection.visibleSourceIndexes).filter(
				(sourceIndex) => sourceIndex < visibleSourceCount,
			)
		: [];
	const startSourceIndex = canReusePrevious
		? Math.min(previousSource.visibleSourceCount, visibleSourceCount)
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
