import type { IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch, TwoHopLinkResult } from "two-hop/model";
import type { TaggedNote } from "indexing/model";
import type { TagGroup } from "two-hop/model";
import type { PluginSettings } from "settings/model";
import { createDedupState } from "two-hop/display/deduplication/usageTracker";
import type { DedupState } from "two-hop/display/deduplication/usageTracker";
import {
	deduplicateLinks,
	deduplicateTaggedNotes,
} from "two-hop/display/deduplication/deduplicateDisplayItems";
import { groupNotesByTag } from "two-hop/display/tagGrouping";
import { isAttachment } from "obsidian-integration/files/fileRules";
import {
	selectLinkDisplayPreprocessSettings,
	selectTagDisplayPreprocessSettings,
	type LinkDisplayPreprocessSettings,
} from "two-hop/display/displayCacheDependencies";

export type MergedLinkItem = TwoHopLinkBranch | IndexedLink;

export interface PreprocessedDisplayData {
	readonly originPath: string | undefined;
	readonly resolvedBranches: readonly TwoHopLinkBranch[];
	readonly resolvedBacklinks: readonly IndexedLink[];
	readonly mergedBaseItems: readonly MergedLinkItem[];
	readonly rawTagGroups: readonly TagGroup[];
	readonly nonEmptyTwoHopBranches: readonly TwoHopLinkBranch[];
	readonly newLinks: readonly IndexedLink[];
}

export interface LinkPreprocessedDisplayData {
	readonly originPath: string | undefined;
	readonly resolvedBranches: readonly TwoHopLinkBranch[];
	readonly resolvedBacklinks: readonly IndexedLink[];
	readonly mergedBaseItems: readonly MergedLinkItem[];
	readonly nonEmptyTwoHopBranches: readonly TwoHopLinkBranch[];
	readonly newLinks: readonly IndexedLink[];
}

export interface TagPreprocessedDisplayData {
	readonly rawTagGroups: readonly TagGroup[];
}

/** Link display data together with the immutable post-link deduplication state. */
export interface LinkPreprocessingResult {
	readonly data: LinkPreprocessedDisplayData;
	readonly state: DedupState;
}

function createEmptyLinkPreprocessedDisplayData(): LinkPreprocessedDisplayData {
	return {
		originPath: undefined,
		resolvedBranches: [],
		resolvedBacklinks: [],
		mergedBaseItems: [],
		nonEmptyTwoHopBranches: [],
		newLinks: [],
	};
}

function createEmptyTagPreprocessedDisplayData(): TagPreprocessedDisplayData {
	return {
		rawTagGroups: [],
	};
}

const NEW_LINK_KEY_SEPARATOR = "\u0000";

function getNewLinkTargetKey(link: IndexedLink): string {
	return link.lookupPath ?? link.path ?? link.rawText;
}

function createNewLinkKey(link: IndexedLink): string {
	return getNewLinkTargetKey(link) + NEW_LINK_KEY_SEPARATOR + (link.path ?? "");
}

function collectNewLink(
	newLinks: IndexedLink[],
	newLinkIndexesByKey: Map<string, number> | undefined,
	link: IndexedLink,
): Map<string, number> | undefined {
	if ((link.backlinkCount ?? 0) >= 2) {
		return newLinkIndexesByKey;
	}

	if (!newLinkIndexesByKey && newLinks.length === 0) {
		newLinks.push(link);
		return undefined;
	}

	const key = createNewLinkKey(link);
	const indexesByKey = newLinkIndexesByKey ?? new Map<string, number>();
	if (!newLinkIndexesByKey) {
		indexesByKey.set(createNewLinkKey(newLinks[0]), 0);
	}
	const existingIndex = indexesByKey.get(key);

	if (existingIndex === undefined) {
		indexesByKey.set(key, newLinks.length);
		newLinks.push(link);
		return indexesByKey;
	}

	newLinks[existingIndex] = link;
	return indexesByKey;
}

function collectDisplayBaseData(
	branches: readonly TwoHopLinkBranch[],
	backlinks: readonly IndexedLink[],
): Pick<
	LinkPreprocessedDisplayData,
	"resolvedBranches" | "resolvedBacklinks" | "mergedBaseItems" | "newLinks"
> {
	let newLinkIndexesByKey: Map<string, number> | undefined;
	const newLinks: IndexedLink[] = [];
	const resolvedBranches: TwoHopLinkBranch[] = [];
	const resolvedBacklinks: IndexedLink[] = [];
	const mergedBaseItems: MergedLinkItem[] = [];

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];
		if (branch.hop1.isUnresolved) {
			newLinkIndexesByKey = collectNewLink(
				newLinks,
				newLinkIndexesByKey,
				branch.hop1,
			);
			continue;
		}

		resolvedBranches.push(branch);
		mergedBaseItems.push(branch);
	}

	for (let index = 0; index < backlinks.length; index += 1) {
		const backlink = backlinks[index];
		if (backlink.isUnresolved) {
			newLinkIndexesByKey = collectNewLink(
				newLinks,
				newLinkIndexesByKey,
				backlink,
			);
			continue;
		}

		resolvedBacklinks.push(backlink);
		mergedBaseItems.push(backlink);
	}

	return {
		resolvedBranches,
		resolvedBacklinks,
		mergedBaseItems,
		newLinks,
	};
}

function filterNonEmptyTwoHopBranches(
	branches: readonly TwoHopLinkBranch[],
): readonly TwoHopLinkBranch[] {
	let filteredBranches: TwoHopLinkBranch[] | undefined;

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];

		if (branch.hop2.length === 0) {
			filteredBranches ??= branches.slice(0, index);
			continue;
		}

		filteredBranches?.push(branch);
	}

	return filteredBranches ?? branches;
}

function filterWithReferenceReuse<T>(
	items: readonly T[],
	shouldKeep: (item: T) => boolean,
): readonly T[] {
	let filteredItems: T[] | undefined;

	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!shouldKeep(item)) {
			filteredItems ??= items.slice(0, index);
			continue;
		}

		filteredItems?.push(item);
	}

	return filteredItems ?? items;
}

function shouldKeepNonAttachmentBacklink(link: IndexedLink): boolean {
	return !isAttachment(link.sourceFile.extension);
}

function shouldKeepNonAttachmentBranch(branch: TwoHopLinkBranch): boolean {
	const path = branch.hop1.path;
	if (!path) return true;

	const dotIndex = path.lastIndexOf(".");
	const extension = dotIndex === -1 ? path : path.slice(dotIndex + 1);
	return !isAttachment(extension);
}

function filterBranchHop2Attachments(
	branches: readonly TwoHopLinkBranch[],
): readonly TwoHopLinkBranch[] {
	let filteredBranches: TwoHopLinkBranch[] | undefined;

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];
		const hop2 = filterWithReferenceReuse(
			branch.hop2,
			shouldKeepNonAttachmentBacklink,
		);

		if (hop2 === branch.hop2) {
			filteredBranches?.push(branch);
			continue;
		}

		filteredBranches ??= branches.slice(0, index);
		filteredBranches.push({
			hop1: branch.hop1,
			hop2,
		});
	}

	return filteredBranches ?? branches;
}

function shouldKeepNonAttachmentTaggedNote(note: TaggedNote): boolean {
	return !isAttachment(note.file.extension);
}

function compareTwoHopBranchesByHop2Count(
	left: TwoHopLinkBranch,
	right: TwoHopLinkBranch,
): number {
	return left.hop2.length - right.hop2.length;
}

function sortTwoHopBranchesIfNeeded(
	branches: readonly TwoHopLinkBranch[],
	settings: LinkDisplayPreprocessSettings,
): readonly TwoHopLinkBranch[] {
	if (settings.twoHopHeaderSortOrder !== "hop2-count-asc" || branches.length < 2) {
		return branches;
	}

	for (let index = 1; index < branches.length; index += 1) {
		if (
			compareTwoHopBranchesByHop2Count(branches[index - 1], branches[index]) > 0
		) {
			return [...branches].sort(compareTwoHopBranchesByHop2Count);
		}
	}

	return branches;
}

/** Builds the link-side input consumed by the sort/assembly stage. */
export function preprocessLinkDisplayData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	initialState: DedupState = createDedupState(),
): LinkPreprocessingResult {
	if (!linkResult) {
		return {
			data: createEmptyLinkPreprocessedDisplayData(),
			state: initialState,
		};
	}

	const preprocessSettings = selectLinkDisplayPreprocessSettings(settings);
	let { branches: originalBranches, backlinks: originalBacklinks } = linkResult;

	if (preprocessSettings.excludeAttachments) {
		originalBacklinks = filterWithReferenceReuse(
			originalBacklinks,
			shouldKeepNonAttachmentBacklink,
		);

		originalBranches = filterWithReferenceReuse(
			originalBranches,
			shouldKeepNonAttachmentBranch,
		);
		originalBranches = filterBranchHop2Attachments(originalBranches);
	}

	let branchesForProcessing: readonly TwoHopLinkBranch[];
	let backlinksForProcessing: readonly IndexedLink[];
	let twoHopBranchesForProcessing: readonly TwoHopLinkBranch[];

	if (settings.dedupeCards) {
		const result = deduplicateLinks(
			initialState,
			originalBranches,
			originalBacklinks,
		);
		branchesForProcessing = result.data.branches;
		backlinksForProcessing = result.data.backlinks;
		twoHopBranchesForProcessing = result.data.twoHopBranches;
		initialState = result.state;
	} else {
		branchesForProcessing = originalBranches;
		backlinksForProcessing = originalBacklinks;
		twoHopBranchesForProcessing = originalBranches;
	}

	const { resolvedBranches, resolvedBacklinks, mergedBaseItems, newLinks } =
		collectDisplayBaseData(branchesForProcessing, backlinksForProcessing);
	const nonEmptyTwoHopBranches = filterNonEmptyTwoHopBranches(
		twoHopBranchesForProcessing,
	);
	const sortedNonEmptyTwoHopBranches = sortTwoHopBranchesIfNeeded(
		nonEmptyTwoHopBranches,
		preprocessSettings,
	);

	return {
		data: {
			originPath: linkResult.originFile.path,
			resolvedBranches,
			resolvedBacklinks,
			mergedBaseItems,
			nonEmptyTwoHopBranches: sortedNonEmptyTwoHopBranches,
			newLinks,
		},
		state: initialState,
	};
}

/** Builds tag groups consumed by the sort/assembly stage. */
export function preprocessTagDisplayData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	initialState: DedupState,
): TagPreprocessedDisplayData {
	const preprocessSettings = selectTagDisplayPreprocessSettings(settings);
	if (
		!linkResult ||
		!preprocessSettings.tagFeaturesEnabled ||
		!preprocessSettings.showTagsSection
	) {
		return createEmptyTagPreprocessedDisplayData();
	}

	let taggedNotes = linkResult.taggedNotes;
	if (preprocessSettings.excludeAttachments) {
		taggedNotes = filterWithReferenceReuse(
			taggedNotes,
			shouldKeepNonAttachmentTaggedNote,
		);
	}

	if (settings.dedupeCards) {
		const result = deduplicateTaggedNotes(initialState, taggedNotes);
		taggedNotes = result.items;
	}

	return {
		rawTagGroups: groupNotesByTag(taggedNotes),
	};
}
