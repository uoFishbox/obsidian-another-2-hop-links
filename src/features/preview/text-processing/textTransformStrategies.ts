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
	/**
	 * Optional fast-path guard. Returns `true` when the rule is provably
	 * unmatchable against `content`, in which case `transformContentForPreview`
	 * skips the `String.prototype.replace` call entirely.
	 *
	 * This avoids both the regex scan and any intermediate string allocation for
	 * rules that cannot match (e.g. a ``wikilinks`` rule on a content with no
	 * `[[`). Different rules need different absence logic (OR vs AND of
	 * candidate substrings), so a predicate keeps the semantics explicit per
	 * rule. The predicate must be conservative: returning `true` only when the
	 * regex truly cannot match.
	 */
	skipIfAbsent?: (content: string) => boolean;
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
	const headingRules: TextTransformRule[] = preserveHeadings
		? []
		: [{
				regex: REGEX.headings,
				replacement: "",
				skipIfAbsent: (content: string) => !content.includes("#"),
			}];

	return [
		...(skipFrontmatterRemoval
			? []
			: [
					{
						regex: REGEX.frontmatter,
						replacement: "",
						skipIfAbsent: (content: string) => !content.includes("---"),
					},
				]),
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
			skipIfAbsent: (content: string) => !content.includes("!["),
		},
		...headingRules,
		{
			regex: REGEX.horizontalRules,
			replacement: "",
			skipIfAbsent: (content: string) => !content.includes("---"),
		},
		{
			regex: REGEX.listMarkers,
			replacement: "",
			skipIfAbsent: (content: string) =>
				!content.includes("-") && !content.includes("*"),
		},
		{
			regex: /^\s*[\r\n]/gm,
			replacement: "",
			skipIfAbsent: (content: string) =>
				!content.includes("\n") && !content.includes("\r"),
		},
		{
			regex: REGEX.highlight,
			replacement: (_: string, p1: string) => p1,
			skipIfAbsent: (content: string) => !content.includes("=="),
		},
		{
			regex: REGEX.wikilinks,
			replacement: (_: string, title: string, alias: string) =>
				`<span class="cosense-card-links__wikilink">${escapeHtml(
					alias || title,
				)}</span>`,
			skipIfAbsent: (content: string) => !content.includes("[["),
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
			skipIfAbsent: (content: string) => !content.includes("]("),
		},
		{
			regex: REGEX.rawUrls,
			replacement: (url: string) =>
				`<span class="cosense-card-links__external-link">${escapeHtml(
					url,
				)}</span>`,
			skipIfAbsent: (content: string) => !content.includes("http"),
		},
		{
			regex: /\n{3,}/g,
			replacement: "\n\n",
			skipIfAbsent: (content: string) => !content.includes("\n\n\n"),
		},
		{
			regex: /[ \t]{2,}/g,
			replacement: " ",
			skipIfAbsent: (content: string) =>
				!content.includes("  ") && !content.includes("\t\t"),
		},
	];
}

export function stripClosedIframes(input: string): string {
	if (!/<iframe\b/i.test(input)) {
		return input;
	}

	return input.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");
}

const RULES_BY_COMBO: Record<
	TextTransformContext,
	Record<"0" | "1", Record<"0" | "1", TextTransformRule[]>>
> = {
	preview: {
		"0": {
			"0": buildCommonRules(false, false),
			"1": buildCommonRules(false, true),
		},
		"1": {
			"0": buildCommonRules(true, false),
			"1": buildCommonRules(true, true),
		},
	},
	searchSnippet: {
		"0": {
			"0": buildCommonRules(false, false),
			"1": buildCommonRules(false, true),
		},
		"1": {
			"0": buildCommonRules(true, false),
			"1": buildCommonRules(true, true),
		},
	},
};

function getCachedRules(
	context: TextTransformContext,
	preserveHeadings: boolean,
	skipFrontmatterRemoval?: boolean,
): TextTransformRule[] {
	return RULES_BY_COMBO[context][preserveHeadings ? "1" : "0"][
		skipFrontmatterRemoval ? "1" : "0"
	];
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
