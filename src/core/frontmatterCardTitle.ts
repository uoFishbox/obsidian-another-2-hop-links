import type { CachedMetadata, TFile } from "obsidian";
import type { FileToLinktext } from "features/search/searchSnapshotBuilders";

export type GetFileMetadata = (file: TFile) => CachedMetadata | null;

export function frontmatterValueToCardTitle(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}

	let text: string;

	if (typeof value === "string") {
		text = value;
	} else if (Array.isArray(value)) {
		const parts: string[] = [];
		for (let i = 0; i < value.length; i++) {
			parts.push(String(value[i]));
		}
		text = parts.join(", ");
	} else if (typeof value === "object") {
		text = JSON.stringify(value);
	} else {
		text = String(value);
	}

	const trimmed = text.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function getPriorityFrontmatterCardTitle(
	file: TFile | null | undefined,
	frontmatterKey: string | null | undefined,
	getMetadata: GetFileMetadata,
): string | null {
	const key = frontmatterKey?.trim();

	if (!file || !key) {
		return null;
	}

	const frontmatter = getMetadata(file)?.frontmatter;
	if (!frontmatter) {
		return null;
	}

	if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
		return null;
	}

	return frontmatterValueToCardTitle(frontmatter[key]);
}

export function getFileCardDisplayTitle(
	file: TFile,
	options: {
		sourcePath: string;
		fileToLinktext: FileToLinktext;
		getMetadata: GetFileMetadata;
		priorityFrontmatterKeyForTitle?: string;
	},
): string {
	return (
		getPriorityFrontmatterCardTitle(
			file,
			options.priorityFrontmatterKeyForTitle,
			options.getMetadata,
		) ?? options.fileToLinktext(file, options.sourcePath, true)
	);
}

export function getFileCardTitleSearchText(
	file: TFile,
	options: {
		sourcePath: string;
		fileToLinktext: FileToLinktext;
		getMetadata: GetFileMetadata;
		priorityFrontmatterKeyForTitle?: string;
	},
): string {
	const displayTitle = getFileCardDisplayTitle(file, options);
	const linkText = options.fileToLinktext(file, options.sourcePath, true);

	return `${displayTitle} ${linkText} ${file.basename} ${file.path}`;
}
