import type { TagReference } from "indexing/model";
import type { TagIndex } from "../indexState";

export function createEmptyTagIndex(): TagIndex {
	return {
		tagToFilePaths: new Map(),
		fileEntries: new Map(),
	};
}

export function addFileTagsToTagIndex(
	tagIndex: TagIndex,
	path: string,
	tags: readonly TagReference[],
): void {
	if (tags.length === 0) {
		return;
	}

	tagIndex.fileEntries.set(path, { tags });
	for (const tagRef of tags) {
		forEachParentTag(tagRef.tag, tagIndex.tagToFilePaths, path, addPathToTagIndex);
	}
}

export function removeFileTagsFromTagIndex(tagIndex: TagIndex, path: string): void {
	const existing = tagIndex.fileEntries.get(path);
	if (!existing) {
		return;
	}

	for (const tagRef of existing.tags) {
		forEachParentTag(
			tagRef.tag,
			tagIndex.tagToFilePaths,
			path,
			removePathFromTagIndex,
		);
	}

	tagIndex.fileEntries.delete(path);
}

export function moveFileTagsInTagIndex(
	tagIndex: TagIndex,
	oldPath: string,
	newPath: string,
): readonly TagReference[] | undefined {
	const existing = tagIndex.fileEntries.get(oldPath);
	if (!existing) {
		return undefined;
	}

	if (oldPath === newPath) {
		return existing.tags;
	}

	removeFileTagsFromTagIndex(tagIndex, newPath);

	for (const tagRef of existing.tags) {
		forEachParentTag(
			tagRef.tag,
			tagIndex.tagToFilePaths,
			oldPath,
			removePathFromTagIndex,
		);
		forEachParentTag(
			tagRef.tag,
			tagIndex.tagToFilePaths,
			newPath,
			addPathToTagIndex,
		);
	}

	tagIndex.fileEntries.delete(oldPath);
	tagIndex.fileEntries.set(newPath, existing);

	return existing.tags;
}

export function replaceFileTagsInTagIndex(
	tagIndex: TagIndex,
	path: string,
	tags: readonly TagReference[],
): void {
	removeFileTagsFromTagIndex(tagIndex, path);
	addFileTagsToTagIndex(tagIndex, path, tags);
}

function getOrCreateTagPathSet(
	tagToFilePaths: Map<string, Set<string>>,
	tag: string,
): Set<string> {
	let paths = tagToFilePaths.get(tag);
	if (!paths) {
		paths = new Set<string>();
		tagToFilePaths.set(tag, paths);
	}
	return paths;
}

function addPathToTagIndex(
	tagToFilePaths: Map<string, Set<string>>,
	path: string,
	parentTag: string,
): void {
	getOrCreateTagPathSet(tagToFilePaths, parentTag).add(path);
}

function removePathFromTagIndex(
	tagToFilePaths: Map<string, Set<string>>,
	path: string,
	parentTag: string,
): void {
	const paths = tagToFilePaths.get(parentTag);
	if (!paths) {
		return;
	}

	paths.delete(path);
	if (paths.size === 0) {
		tagToFilePaths.delete(parentTag);
	}
}

function forEachParentTag<T1, T2>(
	tag: string,
	arg1: T1,
	arg2: T2,
	visitor: (arg1: T1, arg2: T2, parentTag: string) => void,
): void {
	let slash = tag.indexOf("/");
	while (slash !== -1) {
		visitor(arg1, arg2, tag.slice(0, slash));
		slash = tag.indexOf("/", slash + 1);
	}

	visitor(arg1, arg2, tag);
}
