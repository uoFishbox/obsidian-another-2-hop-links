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

const INLINE_CODE_REGEX = /`([^`]+)`/g;
const EMPTY_PROTECTED_SEGMENTS: ProtectedSegment[] = [];

interface ProtectedSegment {
	token: string;
	html: string;
}

function tokeniseProtectedSegments(content: string): {
	content: string;
	segments: ProtectedSegment[];
} {
	if (!content.includes("`") && !content.includes("~~~")) {
		return { content, segments: EMPTY_PROTECTED_SEGMENTS };
	}

	const segments: ProtectedSegment[] = [];
	let nextTokenIndex = 0;

	const withCodeBlocks = replaceFencedCodeBlocks(content, (block) => {
		const code = content.slice(block.contentStart, block.contentEnd);
		const token = buildProtectedSegmentToken(nextTokenIndex++);
		const html = `<span class="cosense-card-links__code-block">${escapeHtml(
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

export function transformContentForPreview(
	content: string,
	options?: TransformContentForPreviewOptions,
): string {
	let transformedContent = content;
	const strategy = getTextTransformStrategy(options?.context);
	const preserveHeadings =
		options?.preserveHeadings ?? strategy.defaultPreserveHeadings;

	const protectedSegments = tokeniseProtectedSegments(transformedContent);
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
