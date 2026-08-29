import type { TFile } from "obsidian";
import type { TaggedNote, TagReference } from "indexing/model";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type { TagIndex } from "../indexState";
import type { IVault } from "obsidian-integration/hostContracts";
import { createFileUsageKeyFromNormalizedPath } from "shared/identity/fileIdentity";
import { compactStringSetValues } from "shared/collections/compactStringSet";

export function normalizeTag(tag: string): string {
	const trimmed = tag.trim();
	if (!trimmed) {
		return "";
	}

	const withoutHash = trimmed.startsWith("#") ? trimmed.substring(1) : trimmed;
	return withoutHash.toLowerCase();
}

function matchesAnyTargetTag(
	candidateTag: string,
	targetSet: ReadonlySet<string>,
): boolean {
	if (targetSet.has(candidateTag)) {
		return true;
	}

	let slash = candidateTag.indexOf("/");
	while (slash !== -1) {
		if (targetSet.has(candidateTag.slice(0, slash))) {
			return true;
		}
		slash = candidateTag.indexOf("/", slash + 1);
	}

	return false;
}

interface CommonTagInfo {
	commonTags: string[];
	position?: TagReference["position"];
}

function collectCommonTagInfo(
	targetSet: ReadonlySet<string>,
	sourceTags: readonly TagReference[],
): CommonTagInfo | undefined {
	const commonTags: string[] = [];
	let firstPosition: TagReference["position"] | undefined;

	for (const ref of sourceTags) {
		if (!matchesAnyTargetTag(ref.tag, targetSet)) {
			continue;
		}

		commonTags.push(ref.tag);
		firstPosition ??= ref.position;
	}

	return commonTags.length > 0
		? {
				commonTags,
				position: firstPosition,
			}
		: undefined;
}

export function getNotesWithCommonTagsFromTagRefs(
	vault: IVault,
	tagIndex: TagIndex,
	targetFile: TFile,
	targetTags: readonly TagReference[],
): TaggedNote[] {
	if (targetTags.length === 0) {
		return [];
	}

	const { tagToFilePaths, fileEntries } = tagIndex;
	const candidatePaths = new Set<string>();

	for (const tagRef of targetTags) {
		const paths = tagToFilePaths.get(tagRef.tag);
		if (!paths) {
			continue;
		}
		for (const path of compactStringSetValues(paths)) {
			candidatePaths.add(path);
		}
	}

	if (candidatePaths.size === 0) {
		return [];
	}

	const targetSet = new Set<string>();
	for (const tagRef of targetTags) {
		targetSet.add(tagRef.tag);
	}
	const taggedNotes: TaggedNote[] = [];
	const targetPath = targetFile.path;

	for (const path of candidatePaths) {
		if (path === targetPath) {
			continue;
		}

		const entry = fileEntries.get(path);
		if (!entry) {
			continue;
		}

		const commonTagInfo = collectCommonTagInfo(targetSet, entry);
		if (!commonTagInfo) {
			continue;
		}

		const file = resolveFileByPath(vault, path);
		if (!file) {
			continue;
		}

		taggedNotes.push({
			file,
			commonTags: commonTagInfo.commonTags,
			path,
			usageKey: createFileUsageKeyFromNormalizedPath(path),
			position: commonTagInfo.position,
		});
	}

	taggedNotes.sort((a, b) => b.commonTags.length - a.commonTags.length);

	return taggedNotes;
}

export function getNotesWithCommonTags(
	vault: IVault,
	tagIndex: TagIndex,
	targetFile: TFile,
	targetTags: string[],
): TaggedNote[] {
	if (targetTags.length === 0) {
		return [];
	}
	const tagRefs = new Array<TagReference>(targetTags.length);
	for (let index = 0; index < targetTags.length; index += 1) {
		tagRefs[index] = { tag: targetTags[index] };
	}
	return getNotesWithCommonTagsFromTagRefs(vault, tagIndex, targetFile, tagRefs);
}

export function getNotesWithTag(
	vault: IVault,
	tagIndex: TagIndex,
	targetTag: string,
): TaggedNote[] {
	const normalizedTargetTag = normalizeTag(targetTag);
	if (!normalizedTargetTag) {
		return [];
	}

	const paths = tagIndex.tagToFilePaths.get(normalizedTargetTag);
	if (!paths) {
		return [];
	}

	const notes: TaggedNote[] = [];
	const descendantPrefix = `${normalizedTargetTag}/`;

	for (const path of compactStringSetValues(paths)) {
		const file = resolveFileByPath(vault, path);
		if (!file) {
			continue;
		}

		const fileTags = tagIndex.fileEntries.get(path);
		let tagRef: TagReference | undefined;
		if (fileTags) {
			for (const candidate of fileTags) {
				if (
					candidate.tag === normalizedTargetTag ||
					candidate.tag.startsWith(descendantPrefix)
				) {
					tagRef = candidate;
					break;
				}
			}
		}
		if (!tagRef) {
			continue;
		}
		const position = tagRef?.position;

		notes.push({
			file,
			path,
			commonTags: [normalizedTargetTag],
			usageKey: createFileUsageKeyFromNormalizedPath(path),
			position: position,
		});
	}

	// パス順などでソートしておくと安定するが、呼び出し元のソートサービスに任せるためここではそのまま
	return notes;
}
