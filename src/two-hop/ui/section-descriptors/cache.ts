import type { TFile } from "obsidian";
import type { DisplayData } from "two-hop/display/displayDataBuilder";
import {
	createCompactSectionId,
	SHOULD_VALIDATE_SECTION_IDS,
} from "cards/components/listPagination";
import { generateBranchKey } from "preview/text/textUtils";
import type { PluginSettings } from "settings/model";
import type { SortOption } from "cards/sorting";
import type { InteractionSettings } from "cards/interactions/interactionTypes";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	createBranchSectionDescriptor,
	createNewLinksSectionDescriptor,
	resolveBranchHeader,
	createPrimarySectionDescriptor,
	createTagSectionDescriptor,
	type PrimarySectionBuildInput,
	type TwoHopInteractionTokenAllocator,
} from "./descriptors";

export interface ResolveTwoHopSectionsParams {
	readonly displayData: DisplayData;
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
	readonly sourceFile: TFile;
	readonly resolveFile: (path: string) => TFile | null;
	readonly fileToLinktext: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string;
	readonly currentSort: SortOption;
	readonly currentSettings: PluginSettings;
	readonly sortContextVersion: number;
	readonly getSortedTwoHopItems: (
		items: readonly IndexedLink[],
	) => readonly IndexedLink[];
	readonly getSortedTagGroupItems: (
		items: readonly TaggedNote[],
	) => readonly TaggedNote[];
	/**
	 * Resolves the materialized prefix length for one section. Replace this
	 * function when pagination inputs change so exact-hit memoization stays valid.
	 */
	readonly getVisibleCount: (sectionId: string, totalCount: number) => number;
	readonly interactionTokens: TwoHopInteractionTokenAllocator;
	readonly onTagClick: (tag: string) => void;
}

/** Memoizes immutable two-hop section publications by explicit input identity. */
export interface TwoHopSectionPublicationMemo {
	resolve(params: ResolveTwoHopSectionsParams): readonly TwoHopSectionModel[];
}

interface CachedSection {
	readonly dependencies: readonly unknown[];
	readonly totalCount: number;
	readonly build: SectionBuilder;
	readonly section: TwoHopSectionModel;
}

type SectionBuilder = (
	itemLimit: number,
	previousItems: readonly TwoHopItemModel[],
) => TwoHopSectionModel;

interface ResolveSnapshot {
	readonly displayData: DisplayData;
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
	readonly sourcePath: string;
	readonly resolveFile: ResolveTwoHopSectionsParams["resolveFile"];
	readonly fileToLinktext: ResolveTwoHopSectionsParams["fileToLinktext"];
	readonly currentSort: SortOption;
	readonly sortContextVersion: number;
	readonly getSortedTwoHopItems: ResolveTwoHopSectionsParams["getSortedTwoHopItems"];
	readonly getSortedTagGroupItems: ResolveTwoHopSectionsParams["getSortedTagGroupItems"];
	readonly getVisibleCount: ResolveTwoHopSectionsParams["getVisibleCount"];
	readonly interactionTokens: TwoHopInteractionTokenAllocator;
	readonly onTagClick: ResolveTwoHopSectionsParams["onTagClick"];
	readonly mobileLongPressAction: PluginSettings["mobileLongPressAction"];
	readonly highlightInPreviewOnHover: boolean;
}

/**
 * Publishes immutable sections and reuses a section only while its direct
 * inputs retain identity. Resolver results are already immutable at this
 * boundary, so no semantic snapshots or deep comparisons are needed.
 */
export function createTwoHopSectionPublicationMemo(): TwoHopSectionPublicationMemo {
	const entries = new Map<string, CachedSection>();
	let previousSnapshot: ResolveSnapshot | undefined;
	let previousSections: readonly TwoHopSectionModel[] = [];

	function resolveSection(
		id: string,
		dependencies: readonly unknown[],
		totalCount: number,
		visibleCount: number,
		build: SectionBuilder,
	): TwoHopSectionModel {
		const cached = entries.get(id);
		const canReuseItems =
			cached !== undefined &&
			cached.totalCount === totalCount &&
			hasSameDependencies(cached.dependencies, dependencies);
		if (canReuseItems && cached.section.items.length === visibleCount) {
			return cached.section;
		}

		const activeBuild = canReuseItems ? cached.build : build;
		const section = activeBuild(
			visibleCount,
			canReuseItems ? cached.section.items : [],
		);
		entries.set(id, {
			dependencies,
			totalCount,
			build: activeBuild,
			section,
		});
		return section;
	}

	return {
		resolve(params) {
			const snapshot = createResolveSnapshot(params);
			if (
				previousSnapshot &&
				hasSameResolveSnapshot(previousSnapshot, snapshot)
			) {
				return previousSections;
			}

			const sections: TwoHopSectionModel[] = [];
			const activeIds = new Set<string>();
			const seenIds = SHOULD_VALIDATE_SECTION_IDS ? new Set<string>() : null;
			const append = (
				id: string,
				dependencies: readonly unknown[],
				totalCount: number,
				build: SectionBuilder,
			): void => {
				if (seenIds?.has(id)) return;
				seenIds?.add(id);
				activeIds.add(id);
				const visibleCount = normalizeVisibleCount(
					params.getVisibleCount(id, totalCount),
					totalCount,
				);
				sections.push(
					resolveSection(id, dependencies, totalCount, visibleCount, build),
				);
			};

			appendPrimarySections(params, append);
			appendBranchSections(params, append);
			appendTagSections(params, append);
			appendNewLinksSection(params, append);

			for (const id of entries.keys()) {
				if (!activeIds.has(id)) entries.delete(id);
			}

			const nextSections = Object.freeze(sections);
			const changed = !hasSameSectionRefs(previousSections, nextSections);
			previousSnapshot = snapshot;
			previousSections = changed ? nextSections : previousSections;
			return previousSections;
		},
	};
}

type AppendSection = (
	id: string,
	dependencies: readonly unknown[],
	totalCount: number,
	build: SectionBuilder,
) => void;

function appendPrimarySections(
	params: ResolveTwoHopSectionsParams,
	append: AppendSection,
): void {
	const createItemInteractionToken =
		params.interactionTokens.createItemInteractionToken;
	const inputs: PrimarySectionBuildInput[] = params.useMergedLinks
		? params.displayData.mergedItems.length > 0
			? [{ kind: "merged", items: params.displayData.mergedItems }]
			: []
		: [
				...(params.displayData.outgoing.length > 0
					? ([
							{ kind: "outgoing", items: params.displayData.outgoing },
						] as const)
					: []),
				...(params.displayData.backlinks.length > 0
					? ([
							{ kind: "backlinks", items: params.displayData.backlinks },
						] as const)
					: []),
			];

	for (const input of inputs) {
		append(
			input.kind,
			[input.items, params.interactionTokens],
			input.items.length,
			(itemLimit, previousItems) =>
				createPrimarySectionDescriptor({
					input,
					itemLimit,
					previousItems,
					createItemInteractionToken,
				}),
		);
	}
}

function appendBranchSections(
	params: ResolveTwoHopSectionsParams,
	append: AppendSection,
): void {
	const interactionSettings: InteractionSettings = Object.freeze({
		mobileLongPressAction: params.currentSettings.mobileLongPressAction,
		highlightInPreviewOnHover: params.currentSettings.highlightInPreviewOnHover,
	});

	for (const branch of params.displayData.twoHopBranches) {
		let sortedItems: readonly IndexedLink[] | null = null;
		const getSortedItems = () =>
			(sortedItems ??= params.getSortedTwoHopItems(branch.hop2));
		const sectionKey = generateBranchKey(branch);
		const id = createCompactSectionId("twohop", sectionKey);
		const header = resolveBranchHeader({
			branch,
			sourceFile: params.sourceFile,
			resolveFile: params.resolveFile,
			fileToLinktext: params.fileToLinktext,
		});
		append(
			id,
			[
				branch,
				params.sourceFile,
				header.targetFile,
				header.title,
				header.className,
				params.currentSort,
				params.sortContextVersion,
				params.getSortedTwoHopItems,
				params.interactionTokens,
				interactionSettings.mobileLongPressAction,
				interactionSettings.highlightInPreviewOnHover,
			],
			branch.hop2.length,
			(itemLimit, previousItems) =>
				createBranchSectionDescriptor(
					{
						branch,
						rawSectionId: id,
						sourceFile: params.sourceFile,
						...header,
						interactionSettings,
						sortedItems: getSortedItems(),
						itemLimit,
						previousItems,
					},
					params.interactionTokens,
				),
		);
	}
}

function appendTagSections(
	params: ResolveTwoHopSectionsParams,
	append: AppendSection,
): void {
	if (!params.showTags) return;
	for (const source of params.displayData.tagGroups) {
		let sortedItems: readonly TaggedNote[] | null = null;
		const getSortedItems = () =>
			(sortedItems ??= params.getSortedTagGroupItems(source.notes));
		const id = `tags-${source.tag}`;
		append(
			id,
			[
				source,
				params.currentSort,
				params.sortContextVersion,
				params.getSortedTagGroupItems,
				params.interactionTokens,
				params.onTagClick,
			],
			source.notes.length,
			(itemLimit, previousItems) =>
				createTagSectionDescriptor(
					{
						source,
						rawSectionId: id,
						sortedItems: getSortedItems(),
						itemLimit,
						previousItems,
						onTagClick: params.onTagClick,
					},
					params.interactionTokens,
				),
		);
	}
}

function appendNewLinksSection(
	params: ResolveTwoHopSectionsParams,
	append: AppendSection,
): void {
	const items = params.displayData.newLinks;
	if (items.length === 0) return;
	append(
		"new-links",
		[items, params.interactionTokens],
		items.length,
		(itemLimit, previousItems) =>
			createNewLinksSectionDescriptor({
				items,
				itemLimit,
				previousItems,
				createItemInteractionToken:
					params.interactionTokens.createItemInteractionToken,
			}),
	);
}

function createResolveSnapshot(params: ResolveTwoHopSectionsParams): ResolveSnapshot {
	return {
		displayData: params.displayData,
		useMergedLinks: params.useMergedLinks,
		showTags: params.showTags,
		sourcePath: params.sourceFile.path,
		resolveFile: params.resolveFile,
		fileToLinktext: params.fileToLinktext,
		currentSort: params.currentSort,
		sortContextVersion: params.sortContextVersion,
		getSortedTwoHopItems: params.getSortedTwoHopItems,
		getSortedTagGroupItems: params.getSortedTagGroupItems,
		getVisibleCount: params.getVisibleCount,
		interactionTokens: params.interactionTokens,
		onTagClick: params.onTagClick,
		mobileLongPressAction: params.currentSettings.mobileLongPressAction,
		highlightInPreviewOnHover: params.currentSettings.highlightInPreviewOnHover,
	};
}

function normalizeVisibleCount(value: number, totalCount: number): number {
	const normalized = Math.floor(value);
	if (!Number.isFinite(normalized)) return totalCount;
	return Math.min(totalCount, Math.max(0, normalized));
}

function hasSameResolveSnapshot(
	current: ResolveSnapshot,
	next: ResolveSnapshot,
): boolean {
	return Object.keys(current).every((key) =>
		Object.is(
			current[key as keyof ResolveSnapshot],
			next[key as keyof ResolveSnapshot],
		),
	);
}

function hasSameDependencies(
	current: readonly unknown[],
	next: readonly unknown[],
): boolean {
	return (
		current.length === next.length &&
		current.every((value, index) => Object.is(value, next[index]))
	);
}

function hasSameSectionRefs(
	current: readonly TwoHopSectionModel[],
	next: readonly TwoHopSectionModel[],
): boolean {
	return (
		current.length === next.length &&
		current.every((section, index) => section === next[index])
	);
}
