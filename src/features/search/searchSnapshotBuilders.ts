import type { TFile } from "obsidian";
import type { TwoHopIndexedLink } from "types/domain";
import type { SearchWorkerItemSnapshot } from "./searchWorkerTypes";
import type { FileToLinktext } from "types/obsidian";
export type { FileToLinktext };

export function buildSearchWorkerItemSnapshot(
	key: string,
	searchText: string,
	targetFilePath: string | null,
): SearchWorkerItemSnapshot {
	return {
		key,
		searchText: searchText.toLowerCase(),
		targetFilePath,
	};
}

export function getBacklinkSearchText(
	sourceFile: TFile,
	sourcePath: string,
	fileToLinktext: FileToLinktext,
): string {
	const title = fileToLinktext(sourceFile, sourcePath, true);
	return `${title} ${sourceFile.path}`;
}

export function getTaggedNoteSearchText(file: TFile): string {
	return `${file.basename} ${file.path}`;
}

export function getFileSearchText(
	file: TFile,
	sourcePath: string,
	fileToLinktext: FileToLinktext,
): string {
	const title = fileToLinktext(file, sourcePath, true);
	return `${title} ${file.path}`;
}

export function getBranchSearchText(
	link: Pick<TwoHopIndexedLink, "displayText" | "rawText" | "path">,
): string {
	return link.displayText ?? link.rawText ?? link.path ?? "";
}

export function getTagGroupSearchText(tag: string): string {
	return `#${tag}`;
}
