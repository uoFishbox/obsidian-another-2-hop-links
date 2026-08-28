import { Component, type App, type TFile } from "obsidian";
import { enqueueMathRender } from "preview/renderers/mathRenderQueue";
import type { EnqueuePreviewRender } from "preview/renderers/previewRenderQueue";
import { processPreviewContent } from "preview/renderers/markdownPreviewRenderer";
import {
	type PreviewDomCommitScope,
	type PreviewDomCommitTask,
} from "preview/scheduling/previewDomCommitScheduler";
import { toPreviewImageSrc } from "preview/renderers/externalImageSource";
import type { PreviewContentAnalysis } from "preview/pipeline/previewContent";
import type { PreviewData, PreviewRequestOptions } from "preview/types";
import { syncMathJaxStylesForNode } from "shared/ui/dom/mathJaxShadowStyles";
import { isAbortError, throwIfAborted } from "preview/pipeline/previewAbort";
import { normalizePreviewQuery } from "preview/pipeline/previewRenderKeys";
import type { CardPreviewSharedCache } from "./cardPreviewSharedCache";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";

function moveChildrenToFragment(source: HTMLElement): DocumentFragment {
	const fragment = source.ownerDocument.createDocumentFragment();
	while (source.firstChild) {
		fragment.appendChild(source.firstChild);
	}
	return fragment;
}

export type CardPreviewLoader = (
	file: TFile,
	signal?: AbortSignal,
	options?: PreviewRequestOptions,
) => Promise<PreviewData>;

export interface CardPreviewRendererOptions {
	app: App;
	getPreview: CardPreviewLoader;
	domCommitScope: PreviewDomCommitScope;
	enqueuePreviewRender: EnqueuePreviewRender;
	sharedCache: CardPreviewSharedCache;
	resolveSearchMatchOffset?: (
		query: string,
		file: TFile | null | undefined,
	) => { readonly offset: number } | undefined;
}

export interface PreviewRenderCallbacks {
	onCommitted(
		contentType: PreviewData["type"] | undefined,
		attachment: CardPreviewAttachment,
	): void;
	onError?(): void;
}

/**
 * Describes whether committed DOM still depends on renderer-owned resources.
 * `detachable` DOM owns everything it needs and may move between hosts after
 * renderer cleanup. `host-bound` DOM must keep renderer resources alive until
 * that DOM is removed or replaced.
 */
export type CardPreviewAttachment = "detachable" | "host-bound";

export type CardPreviewRenderer = (
	container: HTMLElement,
	request: CardPreviewRequest,
	callbacks?: PreviewRenderCallbacks,
) => () => void;

let nextDomCommitScopeId = 0;

/** Owns cancellation, scheduling, rendering, and DOM commits for one card. */
export function createCardPreviewRenderer(
	options: CardPreviewRendererOptions,
): CardPreviewRenderer {
	const domCommitTargetKey = `card-preview:${++nextDomCommitScopeId}`;
	const sharedCache = options.sharedCache;

	const enqueueCoordinatedDomCommit = async (
		task: PreviewDomCommitTask,
	): Promise<boolean> => {
		const result = await options.domCommitScope.schedule(task);
		return result.type === "committed";
	};

	function render(
		container: HTMLElement,
		request: CardPreviewRequest,
		callbacks?: PreviewRenderCallbacks,
	): () => void {
		const abortController = new AbortController();
		let component: Component | undefined;
		const getOrCreateComponent = (): Component => {
			if (!component) {
				component = new Component();
				component.load();
			}
			return component;
		};

		void renderPreview(
			container,
			request,
			callbacks,
			abortController.signal,
			getOrCreateComponent,
		).catch(() => {});

		return () => {
			abortController.abort();
			component?.unload();
		};
	}

	async function renderPreview(
		container: HTMLElement,
		request: CardPreviewRequest,
		callbacks: PreviewRenderCallbacks | undefined,
		signal: AbortSignal,
		getOrCreateComponent: () => Component,
	): Promise<boolean> {
		const { file, renderKey, searchQuery } = request;

		try {
			const preview = request.previewOverride
				? normalizePreviewData(request.previewOverride)
				: normalizePreviewData(
						await options.getPreview(file, signal, {
							cacheRevision: request.previewCacheRevision,
						}),
					);
			const previewForRender = await applySearchContextToPreview(
				preview,
				request,
				signal,
			);

			if (isRenderStale(signal)) return false;

			const enableMathRendering = normalizePreviewQuery(searchQuery).length === 0;
			const previewAnalysis =
				enableMathRendering &&
				previewForRender.type === "text" &&
				previewForRender.content.includes("$")
					? sharedCache.getSharedPreviewAnalysis(
							renderKey,
							previewForRender.content,
						)
					: undefined;
			const shouldDelayMathCardRendering =
				previewForRender.type === "text" &&
				enableMathRendering &&
				previewAnalysis?.hasMathExpression === true;
			const shouldSyncMathStyles = shouldSyncMathJaxStyles(
				enableMathRendering,
				previewAnalysis,
			);

			if (!shouldDelayMathCardRendering) {
				if (previewForRender.type === "text") {
					const renderedFragment = await renderDetachedTextPreviewFragment({
						document: container.ownerDocument,
						content: previewForRender.content,
						enableMathRendering,
						analysis: previewAnalysis,
						enqueuePreviewRender: options.enqueuePreviewRender,
						signal,
					});
					if (isRenderStale(signal)) return false;
					return commitDetachedTextPreview(
						container,
						callbacks,
						signal,
						renderedFragment,
						shouldSyncMathStyles,
					);
				}

				if (previewForRender.type === "image") {
					if (isRenderStale(signal)) return false;
					const imageSrc = toPreviewImageSrc(previewForRender.content);
					const image = container.ownerDocument.createElement("img");
					image.alt = `preview for ${file.basename}`;
					image.loading = "lazy";
					image.decoding = "async";
					image.fetchPriority = "low";

					return enqueueCoordinatedDomCommit({
						targetKey: domCommitTargetKey,
						isStale: () => isRenderStale(signal),
						commit: () => {
							image.src = imageSrc;
							container.replaceChildren(image);
							callbacks?.onCommitted?.("image", "detachable");
							return true;
						},
					});
				}

				const tempContainer = container.ownerDocument.createElement("div");
				await renderPreviewContent(
					tempContainer,
					previewForRender,
					file,
					getOrCreateComponent,
					enableMathRendering,
					previewAnalysis,
					signal,
				);
				if (isRenderStale(signal)) return false;

				const didReplace = await replaceContainerContent(
					container,
					callbacks,
					signal,
					tempContainer,
					shouldSyncMathStyles,
					previewForRender.type,
					resolvePreviewAttachment(previewForRender),
				);
				return didReplace;
			}

			await enqueueMathRender(
				async () => {
					if (isRenderStale(signal)) return;

					if (previewForRender.type === "text") {
						const renderedFragment =
							await renderDetachedTextPreviewFragment({
								document: container.ownerDocument,
								content: previewForRender.content,
								enableMathRendering: true,
								analysis: previewAnalysis,
								enqueuePreviewRender: options.enqueuePreviewRender,
								signal,
							});

						if (isRenderStale(signal)) return;
						await commitDetachedTextPreview(
							container,
							callbacks,
							signal,
							renderedFragment,
							shouldSyncMathStyles,
						);
						return;
					}
				},
				{
					key: `${file.path}:${file.stat.mtime}:${searchQuery}`,
					priority: "high",
					signal,
					ownerWindow: container.ownerDocument.defaultView,
				},
			);

			return !isRenderStale(signal);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) return false;
			await enqueueCoordinatedDomCommit({
				targetKey: domCommitTargetKey,
				isStale: () => isRenderStale(signal),
				commit: () => {
					callbacks?.onError?.();
					return true;
				},
			});
			return false;
		}
	}

	function commitDetachedTextPreview(
		container: HTMLElement,
		callbacks: PreviewRenderCallbacks | undefined,
		signal: AbortSignal,
		fragment: DocumentFragment,
		shouldSyncMathStyles: boolean,
	): Promise<boolean> {
		return enqueueCoordinatedDomCommit({
			targetKey: domCommitTargetKey,
			isStale: () => isRenderStale(signal),
			commit: () => {
				container.replaceChildren(fragment);
				if (shouldSyncMathStyles) {
					syncMathJaxStylesForNode(container);
				}
				callbacks?.onCommitted?.("text", "detachable");
				return true;
			},
		});
	}

	function replaceContainerContent(
		container: HTMLElement,
		callbacks: PreviewRenderCallbacks | undefined,
		signal: AbortSignal,
		source: HTMLElement,
		shouldSyncMathStyles: boolean,
		contentType: PreviewData["type"],
		attachment: CardPreviewAttachment,
	): Promise<boolean> {
		return enqueueCoordinatedDomCommit({
			targetKey: domCommitTargetKey,
			isStale: () => isRenderStale(signal),
			commit: () => {
				container.replaceChildren(moveChildrenToFragment(source));
				if (shouldSyncMathStyles) {
					syncMathJaxStylesForNode(container);
				}
				callbacks?.onCommitted?.(contentType, attachment);
				return true;
			},
		});
	}

	function isRenderStale(signal: AbortSignal): boolean {
		return signal.aborted;
	}

	return render;

	async function applySearchContextToPreview(
		preview: PreviewData,
		request: CardPreviewRequest,
		signal: AbortSignal,
	): Promise<PreviewData> {
		if (preview.type !== "text") return preview;

		const normalizedQuery = normalizePreviewQuery(request.searchQuery);
		if (!normalizedQuery) return preview;

		const contentForRender =
			await sharedCache.applySharedSearchContextToTextPreview({
				previewContent: preview.content,
				cacheKey: request.renderKey,
				targetFile: request.file,
				normalizedQuery,
				firstMatchOffset: () =>
					options.resolveSearchMatchOffset?.(
						request.searchQuery,
						request.file,
					)?.offset,
				settings: request.settings,
				vault: options.app.vault,
				signal,
			});
		if (signal.aborted) return preview;

		return { ...preview, content: contentForRender };
	}
}

function resolvePreviewAttachment(preview: PreviewData): CardPreviewAttachment {
	if (preview.type === "dom") return "host-bound";
	return "detachable";
}

function renderDetachedTextPreviewFragment(params: {
	document: Document;
	content: string;
	enableMathRendering: boolean;
	enqueuePreviewRender: EnqueuePreviewRender;
	analysis?: PreviewContentAnalysis;
	signal?: AbortSignal;
}): Promise<DocumentFragment> {
	const {
		document: ownerDocument,
		content,
		enableMathRendering,
		enqueuePreviewRender,
		analysis,
		signal,
	} = params;

	return enqueuePreviewRender(
		async () => {
			const tempContainer = ownerDocument.createElement("div");
			throwIfAborted(signal, "Preview render aborted");
			await processPreviewContent(tempContainer, content, {
				enableMathRendering,
				analysis,
				syncShadowRootMathStyles: false,
				signal,
			});
			throwIfAborted(signal, "Preview render aborted");
			return moveChildrenToFragment(tempContainer);
		},
		signal,
		ownerDocument.defaultView,
	);
}

async function renderPreviewContent(
	element: HTMLElement,
	preview: PreviewData,
	file: TFile,
	getOrCreateComponent: () => Component,
	enableMathRendering: boolean,
	analysis?: PreviewContentAnalysis,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;

	if (preview.type === "image") {
		element.createEl("img", {
			attr: {
				alt: `preview for ${file.basename}`,
				loading: "lazy",
				decoding: "async",
				fetchpriority: "low",
				src: toPreviewImageSrc(preview.content),
			},
		});
		return;
	}

	if (preview.type === "dom") {
		if (!signal?.aborted) {
			await preview.render(element, getOrCreateComponent(), signal);
		}
		return;
	}

	if (preview.type === "text") {
		await processPreviewContent(element, preview.content, {
			enableMathRendering,
			analysis,
			syncShadowRootMathStyles: false,
			signal,
		});
	}
}

function normalizePreviewData(preview: unknown): PreviewData {
	if (isPreviewData(preview)) return preview;
	return { type: "empty", content: "" };
}

function isPreviewData(preview: unknown): preview is PreviewData {
	if (!preview || typeof preview !== "object") return false;

	const candidate = preview as {
		type?: unknown;
		content?: unknown;
		render?: unknown;
	};
	if (
		(candidate.type === "text" ||
			candidate.type === "image" ||
			candidate.type === "empty") &&
		typeof candidate.content === "string"
	) {
		return true;
	}
	return candidate.type === "dom" && typeof candidate.render === "function";
}

function shouldSyncMathJaxStyles(
	enableMathRendering: boolean,
	analysis?: PreviewContentAnalysis,
): boolean {
	return enableMathRendering && analysis?.hasMathExpression === true;
}
