import type { Pos } from "obsidian";
import type { IndexedLink } from "indexing/model";
import type { CardLinkBranch } from "cards/model";
import {
	createBacklinkIdentitySignature,
	createBranchCardIdentitySignature,
	createBranchIdentitySignature,
	createIndexedLinkIdentitySignature,
	createLinkIdentitySignature,
	createPositionedLinkIdentitySignature,
	serializePositionSignature,
} from "cards/identity/keySignatures";

export function formatLinkText(link: {
	displayText?: string;
	rawText: string;
	isUnresolved?: boolean;
}): string {
	if (link.isUnresolved) {
		const pipeIndex = link.rawText.indexOf("|");
		const hashIndex = link.rawText.indexOf("#");
		const endIndex =
			pipeIndex === -1
				? hashIndex
				: hashIndex === -1
					? pipeIndex
					: Math.min(pipeIndex, hashIndex);
		return endIndex === -1 ? link.rawText : link.rawText.slice(0, endIndex);
	}
	return link.displayText?.trim() || link.rawText;
}

export function generateLinkKey(
	filePath: string,
	linkText: string,
	suffix = "",
): string {
	return createLinkIdentitySignature(filePath, linkText, suffix);
}

export function qualifyDuplicateKey(baseKey: string, occurrenceIndex: number): string {
	return occurrenceIndex <= 0 ? baseKey : `${baseKey}::dup:${occurrenceIndex}`;
}

export function serializePosition(position?: Pos): string {
	return serializePositionSignature(position);
}

export function generatePositionedLinkKey(
	filePath: string,
	linkText: string,
	position?: Pos,
	suffix = "",
): string {
	return createPositionedLinkIdentitySignature(filePath, linkText, position, suffix);
}

export function generateIndexedLinkKey(
	link: Pick<IndexedLink, "sourceFile" | "rawText" | "position">,
	suffix = "",
): string {
	return createIndexedLinkIdentitySignature(link, suffix);
}

export function generateBacklinkKey(
	link: Pick<
		IndexedLink,
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
	return createBacklinkIdentitySignature(link, suffix);
}

export function generateBranchKey(
	branch: Pick<CardLinkBranch, "hop1">,
	suffix = "",
): string {
	return createBranchIdentitySignature(branch, suffix);
}

export function generateBranchCardKey(
	branch: Pick<CardLinkBranch, "hop1">,
	suffix = "",
): string {
	return createBranchCardIdentitySignature(branch, suffix);
}
