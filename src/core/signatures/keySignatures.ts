import type { Pos } from "obsidian";
import { normalizePath } from "obsidian";
import type { TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";

const BACKLINK_IDENTITY_PART_SEPARATOR = "\u001f";
const BACKLINK_IDENTITY_SEPARATOR_COUNT = 5;

export type UsageSignature =
	| { kind: "file"; value: string }
	| { kind: "text"; value: string };

export function normalizePathSignature(path: string): string {
	return normalizePath(path).toLowerCase();
}

export function isNormalizedPathSignature(path: string): boolean {
	return path.indexOf("\\") === -1 && path === path.toLowerCase();
}

function normalizeTextSignature(value: string): string {
	return value.toLowerCase();
}

export function getNormalizedTextSignature(
	value?: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return normalizeTextSignature(trimmed);
}

export function createLengthPrefixedSignature(parts: readonly string[]): string {
	let signature = "";
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (index > 0) {
			signature += "|";
		}
		signature += `${part.length}:${part}`;
	}
	return signature;
}

export function createLinkIdentitySignature(
	filePath: string,
	linkText: string,
	suffix = "",
): string {
	return `${filePath.length}:${filePath}|${linkText.length}:${linkText}|${suffix.length}:${suffix}`;
}

function serializePositionNumber(value: number | undefined): string {
	return typeof value === "number" && Number.isFinite(value)
		? value.toString(36)
		: "";
}

export function serializePositionSignature(position?: Pos): string {
	if (!position) {
		return "";
	}

	return `${serializePositionNumber(position.start?.line)}:${serializePositionNumber(position.start?.col)}:${serializePositionNumber(position.start?.offset)}:${serializePositionNumber(position.end?.line)}:${serializePositionNumber(position.end?.col)}:${serializePositionNumber(position.end?.offset)}`;
}

export function createPositionedLinkIdentitySignature(
	filePath: string,
	linkText: string,
	position?: Pos,
	suffix = "",
): string {
	const positionToken = serializePositionSignature(position);
	const effectiveSuffix = suffix
		? `${suffix}:${positionToken}`
		: `position:${positionToken}`;

	return createLinkIdentitySignature(filePath, linkText, effectiveSuffix);
}

export function createIndexedLinkIdentitySignature(
	link: Pick<TwoHopIndexedLink, "sourceFile" | "rawText" | "position">,
	suffix = "",
): string {
	return createPositionedLinkIdentitySignature(
		link.sourceFile.path,
		link.rawText,
		link.position,
		suffix,
	);
}

export function createBacklinkIdentitySignature(
	link: Pick<
		TwoHopIndexedLink,
		| "sourceFile"
		| "rawText"
		| "path"
		| "lookupPath"
		| "key"
		| "backlinkCount"
		| "isUnresolved"
	>,
	suffix = "",
): string {
	const path = link.path ?? "";
	const lookupPath = link.lookupPath ?? "";
	const key = link.key ?? "";
	const backlinkCount = String(link.backlinkCount ?? -1);
	const unresolved = link.isUnresolved ? "1" : "0";
	const sourcePath = link.sourceFile.path;
	const rawText = link.rawText;
	const metadataLength =
		path.length +
		lookupPath.length +
		key.length +
		backlinkCount.length +
		unresolved.length +
		suffix.length +
		BACKLINK_IDENTITY_SEPARATOR_COUNT;

	return `${sourcePath.length}:${sourcePath}|${rawText.length}:${rawText}|${metadataLength}:${path}${BACKLINK_IDENTITY_PART_SEPARATOR}${lookupPath}${BACKLINK_IDENTITY_PART_SEPARATOR}${key}${BACKLINK_IDENTITY_PART_SEPARATOR}${backlinkCount}${BACKLINK_IDENTITY_PART_SEPARATOR}${unresolved}${BACKLINK_IDENTITY_PART_SEPARATOR}${suffix}`;
}

export function createBranchIdentitySignature(
	branch: Pick<TwoHopLinkBranch, "hop1">,
	suffix = "",
): string {
	return createPositionedLinkIdentitySignature(
		branch.hop1.lookupPath ?? branch.hop1.path ?? branch.hop1.rawText,
		branch.hop1.rawText,
		branch.hop1.position,
		suffix,
	);
}

export function createBranchCardIdentitySignature(
	branch: Pick<TwoHopLinkBranch, "hop1">,
	suffix = "",
): string {
	const link = branch.hop1;
	return createLinkIdentitySignature(
		link.lookupPath ?? link.path ?? link.rawText,
		link.rawText,
		[
			link.path ?? "",
			link.lookupPath ?? "",
			link.displayText ?? "",
			link.key ?? "",
			link.isUnresolved ? "1" : "0",
			suffix,
		].join("\u001f"),
	);
}

export function createBranchUsageSignature(branch: TwoHopLinkBranch): UsageSignature {
	if (!branch.hop1.isUnresolved && branch.hop1.path) {
		return {
			kind: "file",
			value: normalizePathSignature(branch.hop1.path),
		};
	}

	const textValue = getNormalizedTextSignature(
		branch.hop1.lookupPath ?? branch.hop1.rawText,
	);
	if (textValue) {
		return { kind: "text", value: textValue };
	}

	if (branch.hop1.sourceFile?.path) {
		return {
			kind: "file",
			value: normalizePathSignature(branch.hop1.sourceFile.path),
		};
	}

	return { kind: "text", value: "" };
}

export function createIndexedLinkUsageSignature(
	link: TwoHopIndexedLink,
): UsageSignature {
	if (link.sourceFile?.path) {
		return {
			kind: "file",
			value: normalizePathSignature(link.sourceFile.path),
		};
	}

	const textValue = getNormalizedTextSignature(link.displayText ?? link.rawText);
	if (textValue) {
		return { kind: "text", value: textValue };
	}

	return { kind: "text", value: "" };
}

export function createTaggedNoteUsageSignature(path: string): UsageSignature {
	return {
		kind: "file",
		value: normalizePathSignature(path),
	};
}
