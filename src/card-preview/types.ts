import type { Component } from "obsidian";
import type { PreviewRenderSettings } from "./pipeline/previewRenderSettings";

export type PreviewDomRenderer = (
	container: HTMLElement,
	component: Component,
	signal?: AbortSignal,
) => Promise<void>;

export type PreviewData =
	| {
			type: "text";
			content: string;
	  }
	| {
			type: "image";
			content: string;
			byteSize?: number;
	  }
	| {
			type: "empty";
			content: string;
	  }
	| {
			type: "dom";
			content?: never;
			render: PreviewDomRenderer;
	  };

export interface PreviewRequestOptions {
	cacheRevision?: number | string;
	/** Immutable render settings for the card geometry that initiated the request. */
	renderSettings?: PreviewRenderSettings;
}
