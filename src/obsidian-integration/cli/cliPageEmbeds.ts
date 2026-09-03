import { parseLinktext } from "obsidian";
import type { App, EmbedCache, TFile } from "obsidian";
import {
	detectFenceStart,
	skipFencedCodeBlock,
} from "card-preview/text/fencedCodeBlocks";

interface CliPageEmbedBase {
	type: string;
	embeddedFrom: string;
	original: string;
	displayText?: string;
	subpath?: string;
}

export type CliPageEmbed =
	| (CliPageEmbedBase & {
			kind: "file";
			path: string;
			resolved: boolean;
	  })
	| (CliPageEmbedBase & {
			kind: "url";
			url: string;
	  });

export interface ExpandedCliPageContent {
	content: string;
	embeds: CliPageEmbed[];
}

interface EmbedReplacement {
	start: number;
	end: number;
	text: string;
}

interface LocatedEmbed {
	start: number;
	end: number;
	embed: CliPageEmbed;
	replace: boolean;
}

interface ExternalMarkdownImage {
	start: number;
	end: number;
	original: string;
	url: string;
	displayText?: string;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
	flac: "audio/flac",
	m4a: "audio/mp4",
	mp3: "audio/mpeg",
	oga: "audio/ogg",
	ogg: "audio/ogg",
	wav: "audio/wav",
	mov: "video/quicktime",
	mp4: "video/mp4",
	webm: "video/webm",
	pdf: "application/pdf",
	canvas: "application/json",
	md: "text/markdown",
	txt: "text/plain",
};

/** Expands cached Obsidian embeds into semantic inline markers and descriptors. */
export function expandCliPageEmbeds(
	app: App,
	sourceFile: TFile,
	content: string,
): ExpandedCliPageContent {
	const references = app.metadataCache.getFileCache(sourceFile)?.embeds ?? [];
	const locatedEmbeds: LocatedEmbed[] = [];
	const occupiedRanges: { start: number; end: number }[] = [];
	for (const reference of references) {
		const embed = describeEmbed(app, sourceFile, reference);
		const { start, end } = reference.position;
		const replace =
			start.offset < 0 ||
			end.offset > content.length ||
			start.offset >= end.offset ||
			content.slice(start.offset, end.offset) !== reference.original
				? false
				: true;
		locatedEmbeds.push({
			start: start.offset,
			end: end.offset,
			embed,
			replace,
		});
		if (replace) occupiedRanges.push({ start: start.offset, end: end.offset });
	}
	for (const image of findExternalMarkdownImages(content, occupiedRanges)) {
		locatedEmbeds.push({
			start: image.start,
			end: image.end,
			embed: {
				kind: "url",
				type: inferMimeType(image.url, "image/*"),
				url: image.url,
				embeddedFrom: sourceFile.path,
				original: image.original,
				...(image.displayText ? { displayText: image.displayText } : {}),
			},
			replace: true,
		});
	}

	locatedEmbeds.sort((a, b) => a.start - b.start || a.end - b.end);
	const replacements: EmbedReplacement[] = locatedEmbeds
		.filter((located) => located.replace)
		.map((located) => ({
			start: located.start,
			end: located.end,
			text: serializeEmbed(located.embed),
		}));
	let expandedContent = content;
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
		expandedContent =
			expandedContent.slice(0, replacement.start) +
			replacement.text +
			expandedContent.slice(replacement.end);
	}
	return {
		content: expandedContent,
		embeds: locatedEmbeds.map((located) => located.embed),
	};
}

function describeEmbed(
	app: App,
	sourceFile: TFile,
	reference: EmbedCache,
): CliPageEmbed {
	const shared = {
		embeddedFrom: sourceFile.path,
		original: reference.original,
		...(reference.displayText ? { displayText: reference.displayText } : {}),
	};
	if (isExternalUrl(reference.link)) {
		return {
			...shared,
			kind: "url",
			type: inferMimeType(reference.link, "image/*"),
			url: reference.link,
		};
	}

	const { path: linkPath, subpath } = parseLinktext(reference.link);
	const file = app.metadataCache.getFirstLinkpathDest(linkPath, sourceFile.path);
	const path = file?.path ?? linkPath;
	return {
		...shared,
		kind: "file",
		type: inferMimeType(file?.extension ?? path),
		path,
		resolved: file !== null,
		...(subpath ? { subpath } : {}),
	};
}

function serializeEmbed(embed: CliPageEmbed): string {
	const attributes = [
		`type="${escapeAttribute(embed.type)}"`,
		embed.kind === "file"
			? `path="${escapeAttribute(embed.path)}"`
			: `url="${escapeAttribute(embed.url)}"`,
		`embeddedFrom="${escapeAttribute(embed.embeddedFrom)}"`,
	];
	if (embed.kind === "file" && !embed.resolved) attributes.push('resolved="false"');
	if (embed.subpath) attributes.push(`subpath="${escapeAttribute(embed.subpath)}"`);
	if (embed.displayText)
		attributes.push(`displayText="${escapeAttribute(embed.displayText)}"`);
	return `<obsidian:${embed.kind} ${attributes.join(" ")} />`;
}

function inferMimeType(
	pathOrUrl: string,
	fallback = "application/octet-stream",
): string {
	const dataMime = pathOrUrl.match(/^data:([^;,]+)/i)?.[1];
	if (dataMime) return dataMime.toLowerCase();
	let path = pathOrUrl;
	try {
		path = new URL(pathOrUrl).pathname;
	} catch {
		// Vault paths are not URLs.
	}
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return MIME_TYPES[extension] ?? fallback;
}

function isExternalUrl(link: string): boolean {
	return /^(?:https?:|data:)/i.test(link.trim());
}

function findExternalMarkdownImages(
	content: string,
	occupiedRanges: readonly { start: number; end: number }[],
): ExternalMarkdownImage[] {
	if (!content.includes("![")) return [];
	const images: ExternalMarkdownImage[] = [];
	let i = 0;
	let atLineStart = true;
	while (i < content.length) {
		if (atLineStart && detectFenceStart(content, i)) {
			i = skipFencedCodeBlock(content, i);
			atLineStart = true;
			continue;
		}
		if (content[i] === "\n") {
			i++;
			atLineStart = true;
			continue;
		}
		atLineStart = false;
		if (content[i] === "`") {
			i = skipInlineCode(content, i);
			continue;
		}
		if (
			content[i] !== "!" ||
			content[i + 1] !== "[" ||
			isEscaped(content, i) ||
			isInsideRange(i, occupiedRanges)
		) {
			i++;
			continue;
		}
		const image = parseExternalMarkdownImageAt(content, i);
		if (!image) {
			i++;
			continue;
		}
		images.push(image);
		i = image.end;
	}
	return images;
}

function parseExternalMarkdownImageAt(
	content: string,
	start: number,
): ExternalMarkdownImage | undefined {
	const altEnd = findClosingBracket(content, start + 2);
	if (altEnd === -1 || content[altEnd + 1] !== "(") return undefined;
	const destinationEnd = findClosingParenthesis(content, altEnd + 2);
	if (destinationEnd === -1) return undefined;
	const destination = extractMarkdownDestination(
		content.slice(altEnd + 2, destinationEnd),
	);
	if (!/^https?:\/\//i.test(destination)) return undefined;
	const end = destinationEnd + 1;
	const displayText = content.slice(start + 2, altEnd).trim();
	return {
		start,
		end,
		original: content.slice(start, end),
		url: destination,
		...(displayText ? { displayText } : {}),
	};
}

function findClosingBracket(content: string, from: number): number {
	let depth = 0;
	for (let i = from; i < content.length; i++) {
		if (isEscaped(content, i)) continue;
		if (content[i] === "[") {
			depth++;
			continue;
		}
		if (content[i] !== "]") continue;
		if (depth === 0) return i;
		depth--;
	}
	return -1;
}

function findClosingParenthesis(content: string, from: number): number {
	let depth = 0;
	let inAngleDestination = false;
	for (let i = from; i < content.length; i++) {
		if (isEscaped(content, i)) continue;
		const char = content[i];
		if (char === "<" && depth === 0) {
			inAngleDestination = true;
			continue;
		}
		if (char === ">" && inAngleDestination) {
			inAngleDestination = false;
			continue;
		}
		if (inAngleDestination) continue;
		if (char === "(") {
			depth++;
			continue;
		}
		if (char !== ")") continue;
		if (depth === 0) return i;
		depth--;
	}
	return -1;
}

function extractMarkdownDestination(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("<")) {
		const closing = trimmed.indexOf(">");
		return closing === -1 ? "" : trimmed.slice(1, closing).trim();
	}
	let end = 0;
	let depth = 0;
	while (end < trimmed.length) {
		const char = trimmed[end];
		if (char === "\\") {
			end += 2;
			continue;
		}
		if (char === "(") depth++;
		if (char === ")" && depth > 0) depth--;
		if (/\s/.test(char) && depth === 0) break;
		end++;
	}
	return trimmed.slice(0, end).replace(/\\([()])/g, "$1");
}

function skipInlineCode(content: string, start: number): number {
	let fenceEnd = start + 1;
	while (content[fenceEnd] === "`") fenceEnd++;
	const fence = content.slice(start, fenceEnd);
	const closing = content.indexOf(fence, fenceEnd);
	if (closing === -1) return start + 1;
	const newline = content.indexOf("\n", fenceEnd);
	return newline !== -1 && newline < closing ? start + 1 : closing + fence.length;
}

function isInsideRange(
	offset: number,
	ranges: readonly { start: number; end: number }[],
): boolean {
	return ranges.some((range) => offset >= range.start && offset < range.end);
}

function isEscaped(content: string, index: number): boolean {
	let slashCount = 0;
	for (let i = index - 1; i >= 0 && content[i] === "\\"; i--) slashCount++;
	return slashCount % 2 === 1;
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
