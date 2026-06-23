import type { TwoHopLinkBranch, TwoHopIndexedLink } from "types/domain";
import type { TaggedNote } from "types/domain";
import {
	getNormalizedTextSignature,
	isNormalizedPathSignature,
	normalizePathSignature,
	normalizeTextSignature,
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
	const link = branch.hop1;
	if (!link.isUnresolved && link.path) {
		return formatFileUsageKey(normalizePathSignature(link.path));
	}

	const textValue = getNormalizedTextSignature(link.lookupPath ?? link.rawText);
	if (textValue) {
		return formatTextUsageKey(textValue);
	}

	if (link.sourceFile?.path) {
		return formatFileUsageKey(normalizePathSignature(link.sourceFile.path));
	}

	return formatTextUsageKey("");
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
	if (branch.hop1.path) {
		return isNormalizedPathSignature(branch.hop1.path)
			? branch.hop1.path
			: normalizePathSignature(branch.hop1.path);
	}
	return normalizeTextSignature(branch.hop1.lookupPath ?? branch.hop1.rawText);
}
