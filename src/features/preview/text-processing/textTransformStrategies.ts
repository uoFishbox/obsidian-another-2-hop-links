import { escapeHtml } from "./protectedHtml";
import type { TextTransformContext } from "./types";

const NON_PARSED_EMBED_HOSTS = [
	"x.com",
	"twitter.com",
	"youtube.com",
	"youtu.be",
];

function isNonParsedEmbedHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	for (const host of NON_PARSED_EMBED_HOSTS) {
		if (normalized === host) {
			return true;
		}

		const suffixStart = normalized.length - host.length;
		if (
			suffixStart > 0 &&
			normalized[suffixStart - 1] === "." &&
			normalized.endsWith(host)
		) {
			return true;
		}
	}

	return false;
}

function extractEmbedUrlCandidate(
	markdownEmbedTarget: string | undefined,
	wikiEmbedTarget: string | undefined,
): string | null {
	if (markdownEmbedTarget) {
		// ![](<url> "title") の title 部分を除外する
		const candidate = markdownEmbedTarget.trim().match(/^(\S+)/)?.[1];
		return candidate ?? null;
	}

	if (wikiEmbedTarget) {
		// ![[url|alias]] の alias を除外する
		const pipeIndex = wikiEmbedTarget.indexOf("|");
		const candidate = (
			pipeIndex === -1 ? wikiEmbedTarget : wikiEmbedTarget.slice(0, pipeIndex)
		).trim();
		return candidate || null;
	}

	return null;
}

function shouldKeepEmbedLiteral(
	markdownEmbedTarget: string | undefined,
	wikiEmbedTarget: string | undefined,
): boolean {
	const candidate = extractEmbedUrlCandidate(
		markdownEmbedTarget,
		wikiEmbedTarget,
	);
	if (!candidate) {
		return false;
	}

	try {
		const parsed = new URL(candidate);
		return isNonParsedEmbedHost(parsed.hostname);
	} catch {
		return false;
	}
}

const REGEX = {
	frontmatter: /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,
	listMarkers: /^[ \t]*[-*][ \t]+/gm,
	wikilinks: /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
	externalLinks: /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g,
	rawUrls: /(?<!['"=(\[])\b(https?:\/\/[^\s<]+)/g,
	embededContent: /!\[(?:[^\]]*?)\]\(([^)]+?)\)|!\[\[([^\]]+)\]\]/g,
	headings: /^#+\s+.*/gm,
	horizontalRules: /^-{3,}\s*$/gm,
	highlight: /==([^=]+)==/g,
};

export type TextTransformReplacement =
	| string
	| ((substring: string, ...args: any[]) => string);

export interface TextTransformRule {
	regex: RegExp;
	replacement: TextTransformReplacement;
}

interface TextTransformBuildOptions {
	preserveHeadings: boolean;
	skipFrontmatterRemoval?: boolean;
}

export interface TextTransformStrategy {
	readonly context: TextTransformContext;
	readonly defaultPreserveHeadings: boolean;
	buildRules(options: TextTransformBuildOptions): TextTransformRule[];
}

function buildCommonRules(
	preserveHeadings: boolean,
	skipFrontmatterRemoval?: boolean,
): TextTransformRule[] {
	const headingRules = preserveHeadings
		? []
		: [{ regex: REGEX.headings, replacement: "" }];

	return [
		...(skipFrontmatterRemoval
			? []
			: [{ regex: REGEX.frontmatter, replacement: "" }]),
		{
			regex: REGEX.embededContent,
			replacement: (
				match: string,
				markdownEmbedTarget: string | undefined,
				wikiEmbedTarget: string | undefined,
		) =>
				shouldKeepEmbedLiteral(markdownEmbedTarget, wikiEmbedTarget)
					? match
					: "",
		},
		...headingRules,
		{ regex: REGEX.horizontalRules, replacement: "" },
		{ regex: REGEX.listMarkers, replacement: "" },
		{ regex: /^\s*[\r\n]/gm, replacement: "" },
		{
			regex: REGEX.highlight,
			replacement: (_: string, p1: string) => p1,
		},
		{
			regex: REGEX.wikilinks,
			replacement: (_: string, title: string, alias: string) =>
				`<span class="cosense-card-links__wikilink">${escapeHtml(
					alias || title,
				)}</span>`,
		},
		{
			regex: REGEX.externalLinks,
			replacement: (_: string, text: string, url: string) => {
				if (url.includes(":")) {
					return `<span class="cosense-card-links__external-link">${escapeHtml(
						text,
					)}</span>`;
				}
				return `<span class="cosense-card-links__wikilink">${escapeHtml(
					text,
				)}</span>`;
			},
		},
		{
			regex: REGEX.rawUrls,
			replacement: (url: string) =>
				`<span class="cosense-card-links__external-link">${escapeHtml(
					url,
				)}</span>`,
		},
		{ regex: /\n{3,}/g, replacement: "\n\n" },
		{ regex: /[ \t]{2,}/g, replacement: " " },
	];
}

export function stripClosedIframes(input: string): string {
	if (!/<iframe\b/i.test(input)) {
		return input;
	}

	return input.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");
}

const RULE_CACHE = new Map<string, TextTransformRule[]>();

function getCachedRules(
	context: TextTransformContext,
	preserveHeadings: boolean,
	skipFrontmatterRemoval?: boolean,
): TextTransformRule[] {
	const cacheKey = `${context}:${preserveHeadings ? "1" : "0"}:${skipFrontmatterRemoval ? "1" : "0"}`;
	const cachedRules = RULE_CACHE.get(cacheKey);
	if (cachedRules) {
		return cachedRules;
	}

	const rules = buildCommonRules(preserveHeadings, skipFrontmatterRemoval);
	RULE_CACHE.set(cacheKey, rules);
	return rules;
}

const PREVIEW_TEXT_TRANSFORM_STRATEGY: TextTransformStrategy = {
	context: "preview",
	defaultPreserveHeadings: false,
	buildRules: (options) =>
		getCachedRules(
			"preview",
			options.preserveHeadings,
			options.skipFrontmatterRemoval,
		),
};

const SEARCH_SNIPPET_TEXT_TRANSFORM_STRATEGY: TextTransformStrategy = {
	context: "searchSnippet",
	defaultPreserveHeadings: true,
	buildRules: (options) =>
		getCachedRules(
			"searchSnippet",
			options.preserveHeadings,
			options.skipFrontmatterRemoval,
		),
};

const STRATEGY_REGISTRY: Record<TextTransformContext, TextTransformStrategy> = {
	preview: PREVIEW_TEXT_TRANSFORM_STRATEGY,
	searchSnippet: SEARCH_SNIPPET_TEXT_TRANSFORM_STRATEGY,
};

export function getTextTransformStrategy(
	context?: TextTransformContext,
): TextTransformStrategy {
	if (!context) {
		return STRATEGY_REGISTRY.preview;
	}

	return STRATEGY_REGISTRY[context] ?? STRATEGY_REGISTRY.preview;
}
