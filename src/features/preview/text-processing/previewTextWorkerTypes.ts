import type { FencedCodeBlockRange } from "./fencedCodeBlocks";
import type {
	GetContentSnippetOptions,
	PreparedContentSnippet,
	PreviewSnippetSettings,
} from "./snippetExtractor";
import type { TextTransformContext, TransformContentForPreviewOptions } from "./types";
import type { ParsedEmbed } from "./mediaExtractor";
import type { PluginSettings } from "types/settings";

export const PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH = 40000;

export type PreviewTextWorkerRequest =
	| {
			type: "get-content-snippet";
			requestId: number;
			content: string;
			settings?: PluginSettings;
			searchQuery?: string;
			searchOptions?: GetContentSnippetOptions;
	  }
	| {
			type: "render-prepared-content-snippet";
			requestId: number;
			prepared: PreparedContentSnippet;
			settings?: PreviewSnippetSettings;
	  }
	| {
			type: "transform-content";
			requestId: number;
			content: string;
			settings?: PluginSettings;
			options?: TransformContentForPreviewOptions;
	  }
	| {
			type: "highlight-html";
			requestId: number;
			content: string;
			searchQuery?: string;
	  }
	| {
			type: "extract-first-embedded-media";
			requestId: number;
			content: string;
			maxScanChars?: number;
	  }
	| {
			type: "canvas-to-search-text";
			requestId: number;
			input: string | unknown;
	  }
	| {
			type: "find-first-allowed-fenced-code-block";
			requestId: number;
			content: string;
			allowedTypes: readonly string[];
			maxScanChars?: number;
	  }
	| {
			type: "cancel";
			requestId: number;
	  }
	| {
			type: "dispose";
	  };

export type PreviewTextWorkerResult =
	| string
	| ParsedEmbed
	| FencedCodeBlockRange
	| {
			entries: {
				id?: string;
				type: "text" | "file" | "link" | "group";
				value: string;
			}[];
			searchableText: string;
	  }
	| undefined;

export type PreviewTextWorkerResponse =
	| {
			type: "result";
			requestId: number;
			result: PreviewTextWorkerResult;
	  }
	| {
			type: "error";
			requestId: number;
			message: string;
	  };

export interface PreviewTextWorkerRunRequestMap {
	"get-content-snippet": Extract<
		PreviewTextWorkerRequest,
		{ type: "get-content-snippet" }
	>;
	"render-prepared-content-snippet": Extract<
		PreviewTextWorkerRequest,
		{ type: "render-prepared-content-snippet" }
	>;
	"transform-content": Extract<
		PreviewTextWorkerRequest,
		{ type: "transform-content" }
	>;
	"highlight-html": Extract<PreviewTextWorkerRequest, { type: "highlight-html" }>;
	"extract-first-embedded-media": Extract<
		PreviewTextWorkerRequest,
		{ type: "extract-first-embedded-media" }
	>;
	"canvas-to-search-text": Extract<
		PreviewTextWorkerRequest,
		{ type: "canvas-to-search-text" }
	>;
	"find-first-allowed-fenced-code-block": Extract<
		PreviewTextWorkerRequest,
		{ type: "find-first-allowed-fenced-code-block" }
	>;
}
