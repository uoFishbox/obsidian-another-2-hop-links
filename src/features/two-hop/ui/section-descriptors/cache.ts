import type { TFile } from "obsidian";
import type { DisplayData } from "features/two-hop/application/displayDataBuilder";
import {
	createCompactSectionId,
	SHOULD_VALIDATE_SECTION_IDS,
} from "ui/components/common/listPagination";
import { generateBranchKey } from "features/card-preview/text-processing/textUtils";
import type { PluginSettings, SortOption } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { InteractionSettings } from "ui/interactions/interactionTypes";
import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
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
}

export interface TwoHopSectionPublicationCache {
	resolve(params: ResolveTwoHopSectionsParams): readonly TwoHopSectionModel[];
}

interface CachedSection {
	readonly dependencies: readonly unknown[];
	readonly section: TwoHopSectionModel;
}

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
	const onTagClick = (tag: string): void => latestOnTagClick(tag);

	function resolveSection(
		id: string,
		dependencies: readonly unknown[],
		build: () => TwoHopSectionModel,
	): TwoHopSectionModel {
		const cached = entries.get(id);
		if (cached && hasSameDependencies(cached.dependencies, dependencies)) {
			return cached.section;
		}

		const section = build();
		entries.set(id, { dependencies, section });
		return section;
	}

	return {
		resolve(params) {
			latestOnTagClick = params.onTagClick;
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
				build: () => TwoHopSectionModel,
			): void => {
				if (seenIds?.has(id)) return;
				seenIds?.add(id);
				activeIds.add(id);
				sections.push(resolveSection(id, dependencies, build));
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
	};
}

type AppendSection = (
	id: string,
	dependencies: readonly unknown[],
	build: () => TwoHopSectionModel,
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
		append(input.kind, [input.items], () =>
			createPrimarySectionDescriptor({ input, createItemInteractionToken }),
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
			() =>
				createBranchSectionDescriptor(
					{
						branch,
						rawSectionId: id,
						sourceFile: params.sourceFile,
						...header,
						interactionSettings,
						applicationStore: params.applicationStore,
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
		const id = `tags-${source.tag}`;
		append(
			id,
			[
				source,
				params.currentSort,
				sortContextVersion,
				params.applicationStore.getSortedTagGroupItems,
			],
			() =>
				createTagSectionDescriptor(
					{
						source,
						rawSectionId: id,
						applicationStore: params.applicationStore,
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
	append("new-links", [items], () =>
		createNewLinksSectionDescriptor({ items, createItemInteractionToken }),
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
