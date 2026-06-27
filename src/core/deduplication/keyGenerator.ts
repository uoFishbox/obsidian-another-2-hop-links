import type { TwoHopLinkBranch, TwoHopIndexedLink } from "types/domain";
import type { TaggedNote } from "types/domain";
import {
	getNormalizedTextSignature,
	isNormalizedPathSignature,
	normalizePathSignature,
} from "core/signatures/keySignatures";

const FILE_USAGE_KEY_PREFIX = "f:";
const TEXT_USAGE_KEY_PREFIX = "t:";

function formatFileUsageKey(value: string): string {
	return FILE_USAGE_KEY_PREFIX + value;
}

function formatTextUsageKey(value: string): string {
	return TEXT_USAGE_KEY_PREFIX + value;
}

export function getBranchUsageKey(branch: TwoHopLinkBranch): string {
	return getBranchKeys(branch).usageKey;
}

export function getLinkUsageKey(link: TwoHopIndexedLink): string {
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
	return formatFileUsageKey(normalizePathSignature(path));
}

export function getTaggedNoteKey(taggedNote: TaggedNote): string {
	return taggedNote.usageKey ?? getTaggedNoteUsageKey(taggedNote.path);
}

export function getBranchDisplayKey(branch: TwoHopLinkBranch): string {
	return getBranchKeys(branch).displayKey;
}

export interface BranchKeys {
	displayKey: string;
	usageKey: string;
}

export function getBranchKeys(branch: TwoHopLinkBranch): BranchKeys {
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
