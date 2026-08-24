import type { TFile } from "obsidian";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { ProtectedSegment } from "../text-processing/protectedHtml";
import { buildProtectedSegmentToken } from "../text-processing/protectedHtml";

import {
	IMAGE_EXTENSIONS,
	VIDEO_EXTENSIONS,
	SOURCE_EXTENSIONS,
	CANVAS_EXTENSION,
} from "../../../appConstants";

export function isImage(file: TFile): boolean {
	return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function isVideo(file: TFile): boolean {
	return VIDEO_EXTENSIONS.has(file.extension.toLowerCase());
}

export function isSource(file: TFile): boolean {
	return SOURCE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function isCanvas(file: TFile): boolean {
	return file.extension.toLowerCase() === CANVAS_EXTENSION;
}

export interface PreviewContentAnalysis {
	hasDollar: boolean;
	hasMathExpression: boolean;
	contentForMathParsing: string;
	protectedSegments: readonly ProtectedSegment[];
}

export async function getFileContent(file: TFile, vault: IVault): Promise<string> {
	if (isCanvas(file)) {
		const content = await vault.cachedRead(file);
		const { canvasToSearchTextAsync } =
			await import("../text-processing/previewTextProcessingAsync");
		return (await canvasToSearchTextAsync(content)).searchableText;
	}
	if (file.extension === "md" || isSource(file)) {
		return await vault.cachedRead(file);
	}
	return "";
}

export function resolveFile(path: string, metadataCache: IMetadataCache): TFile | null {
	return metadataCache.getFirstLinkpathDest(path, "");
}

const PROTECTED_HTML_CLASS_PATTERN =
	"cosense-card-links__code-block|cosense-card-links__inline-code";

const MATH_EXPRESSION_PATTERN = /(^|[^\\])\$\$[\s\S]+?\$\$|(^|[^\\])\$[^$\n]+?\$/;

const PROTECTED_SEGMENT_REGEX = new RegExp(
	`<(?:span|div)\\b[^>]*class="[^"]*?\\b(?:${PROTECTED_HTML_CLASS_PATTERN})\\b[^"]*"[^>]*>[\\s\\S]*?<\/(?:span|div)>`,
	"g",
);
const EMPTY_PROTECTED_SEGMENTS: readonly ProtectedSegment[] = [];

export function analyzePreviewContent(content: string): PreviewContentAnalysis {
	if (!content.includes("$")) {
		return {
			hasDollar: false,
			hasMathExpression: false,
			contentForMathParsing: content,
			protectedSegments: EMPTY_PROTECTED_SEGMENTS,
		};
	}

	const protectedSegments: ProtectedSegment[] = [];
	let index = 0;
	PROTECTED_SEGMENT_REGEX.lastIndex = 0;
	const contentForMathParsing = content.replace(
		PROTECTED_SEGMENT_REGEX,
		(segment) => {
			const token = buildProtectedSegmentToken(index++);
			protectedSegments.push({ token, html: segment });
			return token;
		},
	);

	return {
		hasDollar: true,
		hasMathExpression: MATH_EXPRESSION_PATTERN.test(contentForMathParsing),
		contentForMathParsing,
		protectedSegments,
	};
}
