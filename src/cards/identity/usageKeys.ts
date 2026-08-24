import type { CardLinkBranch } from "cards/model";
import type { IndexedLink } from "indexing/model";
import type { TaggedNote } from "indexing/model";
import { createFileUsageKey } from "shared/identity/fileIdentity";
import {
	getNormalizedTextSignature,
	isNormalizedPathSignature,
	normalizePathSignature,
} from "cards/identity/keySignatures";

const FILE_USAGE_KEY_PREFIX = "f:";
const TEXT_USAGE_KEY_PREFIX = "t:";

function formatFileUsageKey(value: string): string {
	return FILE_USAGE_KEY_PREFIX + value;
}

function formatTextUsageKey(value: string): string {
	return TEXT_USAGE_KEY_PREFIX + value;
}

export function getBranchUsageKey(branch: CardLinkBranch): string {
	return getBranchKeys(branch).usageKey;
}

export function getLinkUsageKey(link: IndexedLink): string {
	if (link.sourceFile?.path) {
		return formatFileUsageKey(normalizePathSignature(link.sourceFile.path));
	}

	const textValue = getNormalizedTextSignature(link.displayText ?? link.rawText);
	if (textValue) {
		return formatTextUsageKey(textValue);
	}

	return formatTextUsageKey("");
}

export function getTaggedNoteUsageKey(path: string): string {
	return createFileUsageKey(path);
}

export function getTaggedNoteKey(taggedNote: TaggedNote): string {
	return taggedNote.usageKey ?? getTaggedNoteUsageKey(taggedNote.path);
}

export function getBranchDisplayKey(branch: CardLinkBranch): string {
	return getBranchKeys(branch).displayKey;
}

export interface BranchKeys {
	displayKey: string;
	usageKey: string;
}

export function getBranchKeys(branch: CardLinkBranch): BranchKeys {
	const link = branch.hop1;

	if (link.path) {
		const alreadyNormalized = isNormalizedPathSignature(link.path);
		const normalizedPath = alreadyNormalized
			? link.path
			: normalizePathSignature(link.path);

		if (!link.isUnresolved) {
			return {
				displayKey: normalizedPath,
				usageKey: formatFileUsageKey(normalizedPath),
			};
		}

		return {
			displayKey: normalizedPath,
			usageKey: formatTextUsageKey(normalizedPath),
		};
	}

	const textValue = getNormalizedTextSignature(link.lookupPath ?? link.rawText) ?? "";

	if (textValue) {
		return {
			displayKey: textValue,
			usageKey: formatTextUsageKey(textValue),
		};
	}

	if (link.sourceFile?.path) {
		const normalizedPath = normalizePathSignature(link.sourceFile.path);
		return {
			displayKey: normalizedPath,
			usageKey: formatFileUsageKey(normalizedPath),
		};
	}

	return {
		displayKey: "",
		usageKey: formatTextUsageKey(""),
	};
}
