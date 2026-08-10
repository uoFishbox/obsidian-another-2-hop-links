import type { TFile } from "obsidian";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import {
	buildScopedSectionId,
	createCompactSectionId,
	SHOULD_VALIDATE_SECTION_IDS,
} from "ui/components/common/listPagination";
import { generateBranchKey } from "features/card-preview/text-processing/textUtils";
import type { PluginSettings, SortOption } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { InteractionSettings } from "ui/interactions/interactionTypes";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import {
	createBranchSectionDescriptor,
	resolveBranchHeader,
} from "./createBranchDescriptor";
import {
	createPrimarySectionDescriptor,
	type PrimarySectionBuildInput,
} from "./createPrimaryDescriptor";
import { createTagSectionDescriptor } from "./createTagDescriptor";
import { createNewLinksSectionDescriptor } from "./createNewLinksDescriptor";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	createSectionPaginationState,
	type SectionPaginationState,
} from "ui/virtualization/pagination";

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
	readonly applicationStore: ApplicationStore;
	readonly onTagClick: (tag: string) => void;
	readonly initialVisibleCount: number | undefined;
	readonly loadMoreIncrement: number | undefined;
	readonly paginationScope: string;
}

export interface TwoHopSectionPublicationCache {
	resolve(params: ResolveTwoHopSectionsParams): readonly TwoHopSectionModel[];
	loadMore(sectionId: string): readonly TwoHopSectionModel[] | null;
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
	readonly mobileLongPressAction: PluginSettings["mobileLongPressAction"];
	readonly highlightInPreviewOnHover: boolean;
	readonly initialVisibleCount: number | undefined;
	readonly loadMoreIncrement: number | undefined;
	readonly paginationScope: string;
	readonly applicationStore: ApplicationStore;
}

/**
 * Publishes immutable sections and reuses a section only while its direct
 * inputs retain identity. Resolver results are already immutable at this
 * boundary, so no semantic snapshots or deep comparisons are needed.
 */
export function createTwoHopSectionPublicationCache(): TwoHopSectionPublicationCache {
	const entries = new Map<string, CachedSection>();
	const tokens = createTwoHopInteractionTokenAllocator();
	let previousSnapshot: ResolveSnapshot | undefined;
	let previousSections: readonly TwoHopSectionModel[] = [];
	let latestOnTagClick: (tag: string) => void = () => undefined;
	let paginationScope = "";
	let initialVisibleCount: number | undefined;
	let loadMoreIncrement: number | undefined;
	let paginationApplicationStore: ApplicationStore | undefined;
	let expandedLimits: Record<string, number> = {};
	let pagination: SectionPaginationState | null = null;
	const onTagClick = (tag: string): void => latestOnTagClick(tag);

	function configurePagination(params: ResolveTwoHopSectionsParams): void {
		const nextScope = params.paginationScope.trim();
		if (
			pagination &&
			nextScope === paginationScope &&
			Object.is(params.initialVisibleCount, initialVisibleCount) &&
			Object.is(params.loadMoreIncrement, loadMoreIncrement) &&
			params.applicationStore === paginationApplicationStore
		) {
			return;
		}

		paginationScope = nextScope;
		initialVisibleCount = params.initialVisibleCount;
		loadMoreIncrement = params.loadMoreIncrement;
		paginationApplicationStore = params.applicationStore;
		expandedLimits = {};
		pagination = createSectionPaginationState({
			getExpandedLimits: () => expandedLimits,
			setExpandedLimits: (next) => {
				expandedLimits = next;
			},
			applicationStore: params.applicationStore,
			initialVisibleCount,
			loadMoreIncrement,
		});
	}

	function getPaginationId(sectionId: string): string {
		return buildScopedSectionId(sectionId, paginationScope);
	}

	function resolveSection(
		id: string,
		dependencies: readonly unknown[],
		totalCount: number,
		build: SectionBuilder,
	): TwoHopSectionModel {
		const visibleCount = pagination!.getVisibleCount(
			getPaginationId(id),
			totalCount,
		);
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
			latestOnTagClick = params.onTagClick;
			configurePagination(params);
			const sortContextVersion =
				params.applicationStore.getSortContextVersion?.() ?? 0;
			const snapshot = createResolveSnapshot(params, sortContextVersion);
			if (
				previousSnapshot &&
				hasSameResolveSnapshot(previousSnapshot, snapshot)
			) {
				recordCacheMeasurement("exactHit");
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
				sections.push(resolveSection(id, dependencies, totalCount, build));
			};

			appendPrimarySections(params, append, tokens.createItemInteractionToken);
			appendBranchSections(params, sortContextVersion, append, tokens);
			appendTagSections(params, sortContextVersion, append, tokens, onTagClick);
			appendNewLinksSection(params, append, tokens.createItemInteractionToken);

			for (const id of entries.keys()) {
				if (!activeIds.has(id)) entries.delete(id);
			}

			const nextSections = Object.freeze(sections);
			const changed = !hasSameSectionRefs(previousSections, nextSections);
			previousSnapshot = snapshot;
			previousSections = changed ? nextSections : previousSections;
			recordCacheMeasurement(changed ? "miss" : "hit");
			return previousSections;
		},
		loadMore(sectionId) {
			const cached = entries.get(sectionId);
			if (!cached || !pagination) return null;
			const paginationId = getPaginationId(sectionId);
			pagination.loadMore(paginationId, cached.totalCount);
			const nextCount = pagination.getVisibleCount(
				paginationId,
				cached.totalCount,
			);
			if (nextCount === cached.section.items.length) return null;

			const section = cached.build(nextCount, cached.section.items);
			entries.set(sectionId, { ...cached, section });
			const sectionIndex = previousSections.findIndex(
				(candidate) => candidate.id === sectionId,
			);
			if (sectionIndex < 0) return null;
			const nextSections = [...previousSections];
			nextSections[sectionIndex] = section;
			previousSections = Object.freeze(nextSections);
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
	createItemInteractionToken: (interactionKey: string) => string,
): void {
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
			[input.items],
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
	sortContextVersion: number,
	append: AppendSection,
	tokens: ReturnType<typeof createTwoHopInteractionTokenAllocator>,
): void {
	const interactionSettings: InteractionSettings = Object.freeze({
		mobileLongPressAction: params.currentSettings.mobileLongPressAction,
		highlightInPreviewOnHover: params.currentSettings.highlightInPreviewOnHover,
	});

	for (const branch of params.displayData.twoHopBranches) {
		let sortedItems: ReturnType<ApplicationStore["getSortedTwoHopItems"]> | null =
			null;
		const getSortedItems = () =>
			(sortedItems ??= params.applicationStore.getSortedTwoHopItems(branch.hop2));
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
				header.directory,
				params.currentSort,
				sortContextVersion,
				params.applicationStore.getSortedTwoHopItems,
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
					tokens,
				),
		);
	}
}

function appendTagSections(
	params: ResolveTwoHopSectionsParams,
	sortContextVersion: number,
	append: AppendSection,
	tokens: ReturnType<typeof createTwoHopInteractionTokenAllocator>,
	onTagClick: (tag: string) => void,
): void {
	if (!params.showTags) return;
	for (const source of params.displayData.tagGroups) {
		let sortedItems: ReturnType<ApplicationStore["getSortedTagGroupItems"]> | null =
			null;
		const getSortedItems = () =>
			(sortedItems ??= params.applicationStore.getSortedTagGroupItems(
				source.notes,
			));
		const id = `tags-${source.tag}`;
		append(
			id,
			[
				source,
				params.currentSort,
				sortContextVersion,
				params.applicationStore.getSortedTagGroupItems,
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
						onTagClick,
					},
					tokens,
				),
		);
	}
}

function appendNewLinksSection(
	params: ResolveTwoHopSectionsParams,
	append: AppendSection,
	createItemInteractionToken: (interactionKey: string) => string,
): void {
	const items = params.displayData.newLinks;
	if (items.length === 0) return;
	append("new-links", [items], items.length, (itemLimit, previousItems) =>
		createNewLinksSectionDescriptor({
			items,
			itemLimit,
			previousItems,
			createItemInteractionToken,
		}),
	);
}

function createResolveSnapshot(
	params: ResolveTwoHopSectionsParams,
	sortContextVersion: number,
): ResolveSnapshot {
	return {
		displayData: params.displayData,
		useMergedLinks: params.useMergedLinks,
		showTags: params.showTags,
		sourcePath: params.sourceFile.path,
		resolveFile: params.resolveFile,
		fileToLinktext: params.fileToLinktext,
		currentSort: params.currentSort,
		sortContextVersion,
		mobileLongPressAction: params.currentSettings.mobileLongPressAction,
		highlightInPreviewOnHover: params.currentSettings.highlightInPreviewOnHover,
		initialVisibleCount: params.initialVisibleCount,
		loadMoreIncrement: params.loadMoreIncrement,
		paginationScope: params.paginationScope,
		applicationStore: params.applicationStore,
	};
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

function recordCacheMeasurement(result: "exactHit" | "hit" | "miss"): void {
	if (process.env.NODE_ENV === "production") return;
	recordCCLDevMeasurement(`twoHop.sectionDescriptorIdentityCache.${result}`);
}
