import type { TFile } from "obsidian";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import type { ProtectedSegment } from "../text/protectedHtml";
import { buildProtectedSegmentToken } from "../text/protectedHtml";

import {
	isCanvasExtension,
	isImageExtension,
	isSourceExtension,
	isVideoExtension,
} from "card-preview/fileTypes";

export function isImage(file: TFile): boolean {
	return isImageExtension(file.extension);
}

export function isVideo(file: TFile): boolean {
	return isVideoExtension(file.extension);
}

export function isSource(file: TFile): boolean {
	return isSourceExtension(file.extension);
}

export function isCanvas(file: TFile): boolean {
	return isCanvasExtension(file.extension);
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
			await import("../text/previewTextProcessingAsync");
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
