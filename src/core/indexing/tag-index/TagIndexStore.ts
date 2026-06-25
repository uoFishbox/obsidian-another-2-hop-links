import { INDEXING_YIELD_INTERVAL_MS } from "../../../appConstants";
import { extractTags } from "core/indexing/metadata/metadataExtractor";
import { resolveFileByPath } from "core/utils/resolveFileByPath";
import type { TagReference } from "types/domain";
import type { IncrementalFileChange, TagIndex } from "../types/IndexTypes";
import type { IMetadataCache, IVault } from "types/obsidian";
import {
	createEmptyTagIndex,
	moveFileTagsInTagIndex,
	removeFileTagsFromTagIndex,
	replaceFileTagsInTagIndex,
} from "./tagIndexMutations";
import type { TimeSlicingOptions } from "../types/IndexTypes";
import { createYieldScheduler, defaultYieldToMainThread } from "../timeSlicing";

export interface TagMutationResult {
	affectedTags: Set<string>;
	affectedTagSourcePaths: Set<string>;
	tagIndexChanged: boolean;
}

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

	public clear(): void {
		this.tagIndex = createEmptyTagIndex();
	}

	public replace(tagIndex: TagIndex): void {
		this.tagIndex = this.isEnabled() ? tagIndex : createEmptyTagIndex();
	}

	public async applyFileChangesAsync(
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<TagMutationResult> {
		if (!this.isEnabled()) {
			return {
				affectedTags: new Set<string>(),
				affectedTagSourcePaths: new Set<string>(),
				tagIndexChanged: false,
			};
		}

		const yieldScheduler = createYieldScheduler(
			options.yieldFn ?? defaultYieldToMainThread,
			options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
		);
		const affectedTags = new Set<string>();
		const affectedTagSourcePaths = new Set<string>();
		let changeCount = 0;

		for (const change of changes) {
			if (change.type === "rename") {
				const newPathIsMd = change.newPath.toLowerCase().endsWith(".md");
				const previousTags = this.tagIndex.fileEntries.get(
					change.oldPath,
				)?.tags;
				const movedTags = moveFileTagsInTagIndex(
					this.tagIndex,
					change.oldPath,
					change.newPath,
				);
				if (movedTags) {
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
				const previousTags = this.tagIndex.fileEntries.get(change.path)?.tags;

				if (change.type === "delete") {
					removeFileTagsFromTagIndex(this.tagIndex, change.path);
					if (previousTags && previousTags.length > 0) {
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
			affectedTags,
			affectedTagSourcePaths,
			tagIndexChanged: affectedTags.size > 0 || affectedTagSourcePaths.size > 0,
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
 * タグセットが変化したかどうかを判定する。
 * 本文のみの変更では false を返す。
 * undefined と空配列は等価として扱う。
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
