export type TextTransformContext = "preview" | "searchSnippet";

/** Settings that affect raw snippet selection and visual truncation. */
export interface PreviewSnippetSettings {
	readonly cardWidthPx: number;
	readonly cardHeightRatio: number;
	readonly previewMaxLines: number;
	readonly previewMaxChars: number;
	readonly previewVisualLineSafetyMargin: number;
}

/** Optional search metadata supplied by callers that already located a match. */
export interface GetContentSnippetOptions {
	/** Match offset in the original content, before frontmatter removal. */
	readonly firstMatchIndex?: number;
}

/** Raw Markdown and rendering context prepared for the transform stage. */
export interface PreparedContentSnippet {
	readonly contentToProcess: string;
	readonly context: TextTransformContext;
	readonly hasLeadingOmission: boolean;
	readonly hasTrailingOmission: boolean;
}

export interface TransformContentForPreviewOptions {
	preserveHeadings?: boolean;
	context?: TextTransformContext;
	skipFrontmatterRemoval?: boolean;
}
