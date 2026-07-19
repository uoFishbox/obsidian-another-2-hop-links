import {
	buildProtectedSegmentToken,
	restoreProtectedSegments,
	escapeHtml,
} from "./protectedHtml";
import {
	getTextTransformStrategy,
	stripClosedIframes,
} from "./textTransformStrategies";
import { replaceFencedCodeBlocks } from "./fencedCodeBlocks";
import type { TransformContentForPreviewOptions } from "./types";
import type { PluginSettings } from "features/settings/model";

const INLINE_CODE_REGEX = /`([^`]+)`/g;
const EMPTY_PROTECTED_SEGMENTS: ProtectedSegment[] = [];

export type TextTransformSettings = Pick<PluginSettings, "renderCodeBlockTypes">;

interface ProtectedSegment {
	token: string;
	html: string;
}

interface NormalizedCodeBlockTypes {
	array: readonly string[];
	set: ReadonlySet<string>;
}

const NORMALIZED_CODE_BLOCK_TYPES_CACHE = new Map<string, NormalizedCodeBlockTypes>();
const NORMALIZED_CODE_BLOCK_TYPES_WEAK_CACHE = new WeakMap<
	readonly string[],
	NormalizedCodeBlockTypes
>();

export function getNormalizedCodeBlockTypes(
	renderCodeBlockTypes: readonly string[] | undefined,
): NormalizedCodeBlockTypes | undefined {
	if (!renderCodeBlockTypes || renderCodeBlockTypes.length === 0) {
		return undefined;
	}

	const weakCached = NORMALIZED_CODE_BLOCK_TYPES_WEAK_CACHE.get(renderCodeBlockTypes);
	if (weakCached) {
		return weakCached;
	}

	const cacheKey = renderCodeBlockTypes.join("\u0000");
	const cached = NORMALIZED_CODE_BLOCK_TYPES_CACHE.get(cacheKey);
	if (cached) {
		NORMALIZED_CODE_BLOCK_TYPES_WEAK_CACHE.set(renderCodeBlockTypes, cached);
		return cached;
	}

	const array: string[] = [];
	for (const type of renderCodeBlockTypes) {
		const normalized = type.trim().toLowerCase();
		if (normalized) {
			array.push(normalized);
		}
	}

	const result: NormalizedCodeBlockTypes = {
		array,
		set: new Set(array),
	};

	NORMALIZED_CODE_BLOCK_TYPES_CACHE.set(cacheKey, result);
	NORMALIZED_CODE_BLOCK_TYPES_WEAK_CACHE.set(renderCodeBlockTypes, result);
	return result;
}

function tokeniseProtectedSegments(
	content: string,
	allowedBlockTypes?: ReadonlySet<string>,
): { content: string; segments: ProtectedSegment[] } {
	if (!content.includes("`") && !content.includes("~~~")) {
		return { content, segments: EMPTY_PROTECTED_SEGMENTS };
	}

	const segments: ProtectedSegment[] = [];
	let nextTokenIndex = 0;

	const withCodeBlocks = replaceFencedCodeBlocks(content, (block) => {
		const cleanLang = block.infoString.trim().toLowerCase();
		const code = content.slice(block.contentStart, block.contentEnd);
		const token = buildProtectedSegmentToken(nextTokenIndex++);
		const html = allowedBlockTypes?.has(cleanLang)
			? `<div class="twohop-render-block" data-lang="${escapeHtml(
					cleanLang,
				)}" data-code="${encodeURIComponent(code)}"></div>`
			: `<span class="cosense-card-links__code-block">${escapeHtml(
					code.trim(),
				)}</span>`;
		segments.push({ token, html });
		return token;
	});

	INLINE_CODE_REGEX.lastIndex = 0;
	const tokenisedContent = withCodeBlocks.replace(
		INLINE_CODE_REGEX,
		(_: string, code: string) => {
			const token = buildProtectedSegmentToken(nextTokenIndex++);
			segments.push({
				token,
				html: `<span class="cosense-card-links__inline-code">${escapeHtml(
					code,
				)}</span>`,
			});
			return token;
		},
	);

	return { content: tokenisedContent, segments };
}

function getAllowedBlockTypes(
	renderCodeBlockTypes: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
	const normalized = getNormalizedCodeBlockTypes(renderCodeBlockTypes);
	return normalized?.set;
}

export function transformContentForPreview(
	content: string,
	settings?: TextTransformSettings,
	options?: TransformContentForPreviewOptions,
): string {
	let transformedContent = content;
	const strategy = getTextTransformStrategy(options?.context);
	const preserveHeadings =
		options?.preserveHeadings ?? strategy.defaultPreserveHeadings;

	const allowedBlockTypes = getAllowedBlockTypes(settings?.renderCodeBlockTypes);
	const protectedSegments = tokeniseProtectedSegments(
		transformedContent,
		allowedBlockTypes,
	);
	transformedContent = stripClosedIframes(protectedSegments.content);

	const transformations = strategy.buildRules({
		preserveHeadings,
		skipFrontmatterRemoval: options?.skipFrontmatterRemoval,
	});

	for (const { regex, replacement, skipIfAbsent } of transformations) {
		if (skipIfAbsent && skipIfAbsent(transformedContent)) {
			continue;
		}
		transformedContent = transformedContent.replace(regex, replacement as any);
	}

	const restoredContent =
		protectedSegments.segments.length === 0
			? transformedContent
			: restoreProtectedSegments(transformedContent, protectedSegments.segments);

	return restoredContent.trim();
}
