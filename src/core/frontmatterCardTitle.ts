import type { CachedMetadata, TFile } from "obsidian";
import type { FileToLinktext } from "types/obsidian";

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

/** Resolves the title used by cards for an existing target file. */
export function resolveFileCardTitle(
	file: TFile,
	sourcePath: string,
	fileToLinktext: FileToLinktext,
	getMetadata: GetFileMetadata,
	priorityFrontmatterKeyForTitle: string | null | undefined,
): string {
	return (
		getPriorityFrontmatterCardTitle(
			file,
			priorityFrontmatterKeyForTitle,
			getMetadata,
		) ?? fileToLinktext(file, sourcePath, true)
	);
}

export function getFileCardTitleSearchText(
	file: TFile,
	sourcePath: string,
	fileToLinktext: FileToLinktext,
	getMetadata: GetFileMetadata,
	priorityFrontmatterKeyForTitle: string | undefined,
): string {
	const linkText = fileToLinktext(file, sourcePath, true);
	const displayTitle =
		getPriorityFrontmatterCardTitle(
			file,
			priorityFrontmatterKeyForTitle,
			getMetadata,
		) ?? linkText;

	return `${displayTitle} ${linkText} ${file.basename} ${file.path}`;
}
