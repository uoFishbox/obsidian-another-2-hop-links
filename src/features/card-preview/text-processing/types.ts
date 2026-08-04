export type TextTransformContext = "preview" | "searchSnippet";

export interface TransformContentForPreviewOptions {
	preserveHeadings?: boolean;
	context?: TextTransformContext;
	skipFrontmatterRemoval?: boolean;
}
