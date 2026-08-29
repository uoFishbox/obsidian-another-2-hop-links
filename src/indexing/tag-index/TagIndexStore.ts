import { INDEXING_YIELD_INTERVAL_MS } from "indexing/config";
import { extractTags } from "indexing/metadata/metadataExtractor";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type { TagReference } from "indexing/model";
import type { IncrementalFileChange, TagIndex } from "../indexState";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import {
	createEmptyTagIndex,
	moveFileTagsInTagIndex,
	removeFileTagsFromTagIndex,
	replaceFileTagsInTagIndex,
} from "./tagIndexMutations";
import type { TimeSlicingOptions } from "../indexState";
import { createYieldScheduler, defaultYieldToMainThread } from "../timeSlicing";

export interface TagMutationResult {
	readonly affectedTags: ReadonlySet<string>;
	readonly affectedTagSourcePaths: ReadonlySet<string>;
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();

/** Shared result for updates that cannot change the tag index. */
const EMPTY_TAG_MUTATION_RESULT: TagMutationResult = {
	affectedTags: EMPTY_STRING_SET,
	affectedTagSourcePaths: EMPTY_STRING_SET,
};

export class TagIndexStore {
	private tagIndex: TagIndex = createEmptyTagIndex();

	constructor(
		private readonly vault: IVault,
		private readonly metadataCache: IMetadataCache,
		private readonly isEnabled: () => boolean = () => true,
	) {}

	public getSnapshot(): TagIndex {
		if (!this.isEnabled()) {
			return createEmptyTagIndex();
		}
		return this.tagIndex;
	}

	public replace(tagIndex: TagIndex): void {
		this.tagIndex = this.isEnabled() ? tagIndex : createEmptyTagIndex();
	}

	public async applyFileChangesAsync(
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<TagMutationResult> {
		if (!this.isEnabled()) {
			return EMPTY_TAG_MUTATION_RESULT;
		}

		const yieldScheduler = createYieldScheduler(
			options.yieldFn ?? defaultYieldToMainThread,
			options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
		);
		let affectedTags: Set<string> | undefined;
		let affectedTagSourcePaths: Set<string> | undefined;
		let changeCount = 0;

		for (const change of changes) {
			if (change.type === "rename") {
				const newPathIsMd = change.newPath.toLowerCase().endsWith(".md");
				const previousTags = this.tagIndex.fileEntries.get(change.oldPath);
				const movedTags = moveFileTagsInTagIndex(
					this.tagIndex,
					change.oldPath,
					change.newPath,
				);
				if (movedTags) {
					affectedTags ??= new Set<string>();
					affectedTagSourcePaths ??= new Set<string>();
					if (!newPathIsMd) {
						removeFileTagsFromTagIndex(this.tagIndex, change.newPath);
						collectExpandedTagNames(affectedTags, movedTags);
						affectedTagSourcePaths.add(change.oldPath);
					} else {
						collectExpandedTagNames(affectedTags, movedTags);
						affectedTagSourcePaths.add(change.newPath);
						affectedTagSourcePaths.add(change.oldPath);
					}
				} else {
					const file = resolveFileByPath(this.vault, change.newPath);
					if (file && newPathIsMd) {
						const cache = this.metadataCache.getFileCache(file);
						const tags = extractTags(cache);
						const tagSetChanged = hasTagSetChanged(previousTags, tags);
						if (tagSetChanged) {
							affectedTags ??= new Set<string>();
							affectedTagSourcePaths ??= new Set<string>();
							collectExpandedTagNames(affectedTags, previousTags);
							collectExpandedTagNames(affectedTags, tags);
							affectedTagSourcePaths.add(change.newPath);
							replaceFileTagsInTagIndex(
								this.tagIndex,
								change.newPath,
								tags,
							);
						}
					}
				}
			} else {
				const previousTags = this.tagIndex.fileEntries.get(change.path);

				if (change.type === "delete") {
					removeFileTagsFromTagIndex(this.tagIndex, change.path);
					if (previousTags && previousTags.length > 0) {
						affectedTags ??= new Set<string>();
						affectedTagSourcePaths ??= new Set<string>();
						collectExpandedTagNames(affectedTags, previousTags);
						affectedTagSourcePaths.add(change.path);
					}
				} else {
					const pathIsMd = change.path.toLowerCase().endsWith(".md");
					const file = resolveFileByPath(this.vault, change.path);
					if (file && pathIsMd) {
						const cache = this.metadataCache.getFileCache(file);
						const tags = extractTags(cache);
						const tagSetChanged = hasTagSetChanged(previousTags, tags);
						if (tagSetChanged) {
							affectedTags ??= new Set<string>();
							affectedTagSourcePaths ??= new Set<string>();
							collectExpandedTagNames(affectedTags, previousTags);
							collectExpandedTagNames(affectedTags, tags);
							affectedTagSourcePaths.add(change.path);
							replaceFileTagsInTagIndex(this.tagIndex, change.path, tags);
						}
					}
				}
			}

			changeCount++;
			const pendingYield = yieldScheduler.checkpoint(changeCount, 1);
			if (pendingYield) {
				await pendingYield;
			}
		}

		return {
			affectedTags: affectedTags ?? EMPTY_STRING_SET,
			affectedTagSourcePaths: affectedTagSourcePaths ?? EMPTY_STRING_SET,
		};
	}
}

function collectExpandedTagNames(
	target: Set<string>,
	tags: readonly TagReference[] | undefined,
): void {
	if (!tags) {
		return;
	}

	for (const tagRef of tags) {
		const tag = tagRef.tag;
		if (!tag) {
			continue;
		}

		let slash = tag.indexOf("/");
		while (slash !== -1) {
			target.add(tag.slice(0, slash));
			slash = tag.indexOf("/", slash + 1);
		}

		target.add(tag);
	}
}

/**
 * Determines whether a tag set changed.
 * Returns false for body-only changes.
 * Treats undefined and an empty array as equivalent.
 */
function hasTagSetChanged(
	previous: readonly TagReference[] | undefined,
	next: readonly TagReference[] | undefined,
): boolean {
	const prevEmpty = !previous || previous.length === 0;
	const nextEmpty = !next || next.length === 0;
	if (prevEmpty && nextEmpty) return false;
	if (prevEmpty || nextEmpty) return true;
	if (previous.length !== next.length) return true;

	let tagsMatchByIndex = true;
	for (let index = 0; index < previous.length; index++) {
		if (previous[index].tag === next[index].tag) {
			continue;
		}
		tagsMatchByIndex = false;
		break;
	}
	if (tagsMatchByIndex) return false;

	const previousTags = new Set<string>();
	const nextTags = new Set<string>();

	for (const ref of previous) {
		if (ref.tag) previousTags.add(ref.tag);
	}
	for (const ref of next) {
		if (ref.tag) nextTags.add(ref.tag);
	}

	if (previousTags.size !== nextTags.size) return true;
	for (const tag of previousTags) {
		if (!nextTags.has(tag)) return true;
	}

	return false;
}
