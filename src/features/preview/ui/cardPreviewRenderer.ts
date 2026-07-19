import { Component, type App, type Pos, type TFile } from "obsidian";
import { enqueueMathRender } from "features/preview/renderers/mathRenderQueue";
import { processPreviewContent } from "features/preview/renderers/markdownPreviewRenderer";
import {
	enqueuePreviewDomCommit,
	type PreviewDomCommitTask,
} from "features/preview/scheduling/previewDomCommitScheduler";
import { toPreviewImageSrc } from "features/preview/renderers/externalImageSource";
import type { PreviewContentAnalysis } from "features/preview/core/previewContent";
import type { PreviewData, PreviewRequestOptions } from "ui/context/linkContext";
import { syncMathJaxStylesForNode } from "ui/shared/dom/mathJaxShadowStyles";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	applySharedSearchContextToTextPreview,
	canShareRenderedTextPreview,
	cloneRenderedPreviewContent,
	getOrCreateRenderedTextPreviewEntry,
	getRenderedPreviewCacheEntry,
	getSharedPreviewAnalysis,
	normalizePreviewQuery,
	type RenderedPreviewCacheEntry,
	type PreviewSearchContext,
} from "./cardPreviewSharedCache";
import type { CardPreviewRenderRequest } from "./cardPreviewRenderRequest";

export type CardPreviewLoader = (
	file: TFile,
	signal?: AbortSignal,
	options?: PreviewRequestOptions,
) => Promise<PreviewData>;

export interface CardPreviewRendererOptions {
	app: App;
	getPreview: CardPreviewLoader;
	frameCoordinator?: VirtualFrameCoordinator;
	resolveSearchMatchPosition?: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
	onMathRenderingChange: (isRendering: boolean) => void;
	onPreviewContentTypeChange: (contentType: PreviewData["type"] | undefined) => void;
	onRendered: () => void;
}

export type CardPreviewRenderer = (
	container: HTMLElement,
	request: CardPreviewRenderRequest,
) => () => void;

let nextDomCommitScopeId = 0;

/** Owns cancellation, scheduling, cache reuse, and DOM commits for one card. */
export function createCardPreviewRenderer(
	options: CardPreviewRendererOptions,
): CardPreviewRenderer {
	const domCommitScopeKey = `card-preview:${++nextDomCommitScopeId}`;
	let renderSequence = 0;
	let lastAppliedRenderCacheKey: string | undefined;

	const enqueueCoordinatedDomCommit = (
		task: PreviewDomCommitTask,
	): Promise<boolean> =>
		enqueuePreviewDomCommit({
			...task,
			frameCoordinator: options.frameCoordinator,
		});

	function render(
		container: HTMLElement,
		request: CardPreviewRenderRequest,
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
		const renderToken = ++renderSequence;

		void renderPreview(
			container,
			request,
			abortController.signal,
			renderToken,
			getOrCreateComponent,
		).then((didRender) => {
			if (
				didRender &&
				!abortController.signal.aborted &&
				renderToken === renderSequence
			) {
				options.onRendered();
			}
		});

		return () => {
			abortController.abort();
			component?.unload();
		};
	}

	async function renderPreview(
		container: HTMLElement,
		request: CardPreviewRenderRequest,
		signal: AbortSignal,
		renderToken: number,
		getOrCreateComponent: () => Component,
	): Promise<boolean> {
		const { file, renderCacheKey, searchQuery } = request;

		try {
			if (await applyRenderedEntry(container, request, signal, renderToken)) {
				options.onMathRenderingChange(false);
				return true;
			}

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

			if (isRenderStale(signal, renderToken)) return false;

			const enableMathRendering = normalizePreviewQuery(searchQuery).length === 0;
			const previewAnalysis =
				enableMathRendering &&
				previewForRender.type === "text" &&
				previewForRender.content.includes("$")
					? getSharedPreviewAnalysis(renderCacheKey, previewForRender.content)
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
				options.onMathRenderingChange(false);

				if (
					previewForRender.type === "text" &&
					canShareRenderedTextPreview(previewForRender.content)
				) {
					const renderedEntry = await getOrCreateRenderedTextPreviewEntry({
						cacheKey: renderCacheKey,
						content: previewForRender.content,
						app: options.app,
						sourcePath: file.path,
						enableMathRendering,
						analysis: previewAnalysis,
						signal,
					});
					if (isRenderStale(signal, renderToken)) return false;
					return commitRenderedTextEntry(
						container,
						request,
						signal,
						renderToken,
						renderedEntry,
						shouldSyncMathStyles,
					);
				}

				if (previewForRender.type === "image") {
					if (isRenderStale(signal, renderToken)) return false;
					const image = document.createElement("img");
					image.alt = `preview for ${file.basename}`;
					image.loading = "lazy";
					image.decoding = "async";
					image.fetchPriority = "low";
					image.src = toPreviewImageSrc(previewForRender.content);

					return enqueueCoordinatedDomCommit({
						targetKey: domCommitScopeKey,
						isStale: () => isRenderStale(signal, renderToken),
						commit: () => {
							if (shouldSkipDomApply(container, request)) return false;
							options.onPreviewContentTypeChange("image");
							container.replaceChildren(image);
							lastAppliedRenderCacheKey = renderCacheKey;
							return true;
						},
					});
				}

				const tempContainer = document.createElement("div");
				await renderPreviewContent(
					tempContainer,
					previewForRender,
					file,
					options.app,
					getOrCreateComponent(),
					enableMathRendering,
					previewAnalysis,
					signal,
				);
				if (isRenderStale(signal, renderToken)) return false;

				const didReplace = await replaceContainerContent(
					container,
					request,
					signal,
					renderToken,
					tempContainer,
					shouldSyncMathStyles,
				);
				if (didReplace) {
					options.onPreviewContentTypeChange(previewForRender.type);
				}
				return didReplace;
			}

			options.onMathRenderingChange(true);
			await enqueueMathRender(
				async () => {
					if (isRenderStale(signal, renderToken)) return;

					if (
						previewForRender.type === "text" &&
						canShareRenderedTextPreview(previewForRender.content)
					) {
						const renderedEntry = await getOrCreateRenderedTextPreviewEntry(
							{
								cacheKey: renderCacheKey,
								content: previewForRender.content,
								app: options.app,
								sourcePath: file.path,
								enableMathRendering: true,
								analysis: previewAnalysis,
								signal,
							},
						);

						if (isRenderStale(signal, renderToken)) return;
						const didCommit = await commitRenderedTextEntry(
							container,
							request,
							signal,
							renderToken,
							renderedEntry,
							shouldSyncMathStyles,
						);
						if (!didCommit) {
							options.onMathRenderingChange(false);
							return;
						}
						options.onMathRenderingChange(false);
						return;
					}

					const mathContainer = document.createElement("div");
					await renderPreviewContent(
						mathContainer,
						previewForRender,
						file,
						options.app,
						getOrCreateComponent(),
						true,
						previewAnalysis,
						signal,
					);

					if (isRenderStale(signal, renderToken)) return;
					if (
						await replaceContainerContent(
							container,
							request,
							signal,
							renderToken,
							mathContainer,
							true,
						)
					) {
						options.onPreviewContentTypeChange(previewForRender.type);
						options.onMathRenderingChange(false);
					}
				},
				{
					key: `${file.path}:${file.stat.mtime}:${searchQuery}`,
					priority: "high",
					signal,
				},
			);

			return !isRenderStale(signal, renderToken);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) return false;
			await enqueueCoordinatedDomCommit({
				targetKey: domCommitScopeKey,
				isStale: () => isRenderStale(signal, renderToken),
				commit: () => {
					options.onPreviewContentTypeChange(undefined);
					handlePreviewError(container, error);
					return true;
				},
			});
			return false;
		}
	}

	async function applyRenderedEntry(
		container: HTMLElement,
		request: CardPreviewRenderRequest,
		signal: AbortSignal,
		renderToken: number,
	): Promise<boolean> {
		const renderedEntry = getRenderedPreviewCacheEntry(request.renderCacheKey);
		if (!renderedEntry) return false;

		const didMutateDom = await enqueueCoordinatedDomCommit({
			targetKey: domCommitScopeKey,
			isStale: () => isRenderStale(signal, renderToken),
			commit: () => {
				if (shouldSkipDomApply(container, request)) return false;
				options.onPreviewContentTypeChange("text");
				container.replaceChildren(cloneRenderedPreviewContent(renderedEntry));
				lastAppliedRenderCacheKey = request.renderCacheKey;
				if (renderedEntry.hasMath) {
					syncMathJaxStylesForNode(container);
				}
				return true;
			},
		});
		return didMutateDom || shouldSkipDomApply(container, request);
	}

	function commitRenderedTextEntry(
		container: HTMLElement,
		request: CardPreviewRenderRequest,
		signal: AbortSignal,
		renderToken: number,
		renderedEntry: RenderedPreviewCacheEntry,
		shouldSyncMathStyles: boolean,
	): Promise<boolean> {
		return enqueueCoordinatedDomCommit({
			targetKey: domCommitScopeKey,
			isStale: () => isRenderStale(signal, renderToken),
			commit: () => {
				if (shouldSkipDomApply(container, request)) return false;
				options.onPreviewContentTypeChange("text");
				container.replaceChildren(cloneRenderedPreviewContent(renderedEntry));
				lastAppliedRenderCacheKey = request.renderCacheKey;
				if (shouldSyncMathStyles) {
					syncMathJaxStylesForNode(container);
				}
				return true;
			},
		});
	}

	function replaceContainerContent(
		container: HTMLElement,
		request: CardPreviewRenderRequest,
		signal: AbortSignal,
		renderToken: number,
		source: HTMLElement,
		shouldSyncMathStyles: boolean,
	): Promise<boolean> {
		return enqueueCoordinatedDomCommit({
			targetKey: domCommitScopeKey,
			isStale: () => isRenderStale(signal, renderToken),
			commit: () => {
				if (shouldSkipDomApply(container, request)) return false;
				container.replaceChildren();
				while (source.firstChild) {
					container.appendChild(source.firstChild);
				}
				lastAppliedRenderCacheKey = request.renderCacheKey;
				if (shouldSyncMathStyles) {
					syncMathJaxStylesForNode(container);
				}
				return true;
			},
		});
	}

	function shouldSkipDomApply(
		container: HTMLElement,
		request: CardPreviewRenderRequest,
	): boolean {
		return (
			lastAppliedRenderCacheKey === request.renderCacheKey &&
			!!container.firstChild &&
			request.previewOverride?.type !== "dom"
		);
	}

	function isRenderStale(signal: AbortSignal, renderToken: number): boolean {
		return signal.aborted || renderToken !== renderSequence;
	}

	return render;

	async function applySearchContextToPreview(
		preview: PreviewData,
		request: CardPreviewRenderRequest,
		signal: AbortSignal,
	): Promise<PreviewData> {
		if (preview.type !== "text") return preview;

		const normalizedQuery = normalizePreviewQuery(request.searchQuery);
		if (!normalizedQuery) return preview;

		const contentForRender = await applySharedSearchContextToTextPreview({
			previewContent: preview.content,
			previewContentIdentityKey: request.previewContentIdentityKey,
			targetFile: request.file,
			normalizedQuery,
			searchContext: () => buildPreviewSearchContext(request),
			settings: request.settings,
			vault: options.app.vault,
			signal,
		});
		if (signal.aborted) return preview;

		return { ...preview, content: contentForRender };
	}

	function buildPreviewSearchContext(
		request: CardPreviewRenderRequest,
	): PreviewSearchContext {
		const firstMatchOffset = options.resolveSearchMatchPosition?.(
			request.searchQuery,
			request.file,
		)?.start.offset;

		return {
			query: request.searchQuery,
			...(typeof firstMatchOffset === "number" && firstMatchOffset >= 0
				? { firstMatchOffset }
				: {}),
		};
	}
}

async function renderPreviewContent(
	element: HTMLElement,
	preview: PreviewData,
	file: TFile,
	app: App,
	component: Component,
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
			await preview.render(element, component, signal);
		}
		return;
	}

	if (preview.type === "text") {
		await processPreviewContent(
			element,
			preview.content,
			app,
			file.path,
			component,
			{
				enableMathRendering,
				analysis,
				syncShadowRootMathStyles: false,
				signal,
			},
		);
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

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";
}

function handlePreviewError(element: HTMLElement, error: unknown): void {
	console.error("Preview error:", error);
	element.replaceChildren();
	const errorDiv = document.createElement("div");
	errorDiv.className = "error";
	errorDiv.textContent = "Preview not available.";
	element.appendChild(errorDiv);
}
