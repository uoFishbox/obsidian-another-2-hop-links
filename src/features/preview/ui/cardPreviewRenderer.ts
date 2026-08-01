import { Component, type App, type Pos, type TFile } from "obsidian";
import { enqueueMathRender } from "features/preview/renderers/mathRenderQueue";
import { processPreviewContent } from "features/preview/renderers/markdownPreviewRenderer";
import {
	type PreviewDomCommitScheduler,
	type PreviewDomCommitTask,
} from "features/preview/scheduling/previewDomCommitScheduler";
import { toPreviewImageSrc } from "features/preview/renderers/externalImageSource";
import type { PreviewContentAnalysis } from "features/preview/core/previewContent";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";
import { syncMathJaxStylesForNode } from "ui/shared/dom/mathJaxShadowStyles";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { isAbortError } from "features/preview/core/previewAbort";
import { normalizePreviewQuery } from "features/preview/core/previewRenderKeys";
import {
	canShareRenderedTextPreview,
	type CardPreviewSharedCache,
	type RenderedTextPreviewCacheEntry,
	type PreviewSearchContext,
} from "./cardPreviewSharedCache";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";

function moveChildrenToFragment(source: HTMLElement): DocumentFragment {
	const fragment = document.createDocumentFragment();
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
	frameCoordinator?: VirtualFrameCoordinator;
	/** Resolves the scrolling DOM commit rate dynamically. */
	getDomCommitsPerSecond?: () => number;
	domCommitScheduler: PreviewDomCommitScheduler;
	sharedCache: CardPreviewSharedCache;
	resolveSearchMatchPosition?: (
		query: string,
		file: TFile | null | undefined,
	) => Pos | undefined;
	onMathRenderingChange?: (isRendering: boolean) => void;
}

export interface PreviewRenderCallbacks {
	isCurrent(): boolean;
	onCommitted(
		contentType: PreviewData["type"] | undefined,
		retention: CardPreviewRetention,
	): void;
	onError?(): void;
}

export type CardPreviewRetention = "resident" | "lifecycle-bound";

export type CardPreviewRenderer = (
	container: HTMLElement,
	request: CardPreviewRequest,
	callbacks?: PreviewRenderCallbacks,
) => () => void;

let nextDomCommitScopeId = 0;

/** Owns cancellation, scheduling, cache reuse, and DOM commits for one card. */
export function createCardPreviewRenderer(
	options: CardPreviewRendererOptions,
): CardPreviewRenderer {
	const domCommitScopeKey = `card-preview:${++nextDomCommitScopeId}`;
	const sharedCache = options.sharedCache;
	let lastAppliedRenderCacheKey: string | undefined;

	const enqueueCoordinatedDomCommit = async (
		task: PreviewDomCommitTask,
	): Promise<boolean> => {
		const result = await options.domCommitScheduler.enqueue({
			...task,
			frameCoordinator: options.frameCoordinator,
			getCommitsPerSecond: options.getDomCommitsPerSecond,
		});
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
			if (await applyRenderedEntry(container, request, callbacks, signal)) {
				options.onMathRenderingChange?.(false);
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
				options.onMathRenderingChange?.(false);

				if (
					previewForRender.type === "text" &&
					canShareRenderedTextPreview(previewForRender.content)
				) {
					const renderedEntry =
						await sharedCache.getOrCreateRenderedTextPreviewEntry({
							cacheKey: renderKey,
							content: previewForRender.content,
							app: options.app,
							sourcePath: file.path,
							enableMathRendering,
							analysis: previewAnalysis,
							signal,
						});
					if (isRenderStale(signal)) return false;
					return commitRenderedTextEntry(
						container,
						request,
						callbacks,
						signal,
						renderedEntry,
						shouldSyncMathStyles,
					);
				}

				if (previewForRender.type === "image") {
					if (isRenderStale(signal)) return false;
					const image = document.createElement("img");
					image.alt = `preview for ${file.basename}`;
					image.loading = "lazy";
					image.decoding = "async";
					image.fetchPriority = "low";
					image.src = toPreviewImageSrc(previewForRender.content);

					return enqueueCoordinatedDomCommit({
						targetKey: domCommitScopeKey,
						isStale: () => isRenderStale(signal),
						commit: () => {
							if (!shouldSkipDomApply(container, request)) {
								container.replaceChildren(image);
							}
							lastAppliedRenderCacheKey = renderKey;
							callbacks?.onCommitted?.("image", "resident");
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
					getOrCreateComponent,
					enableMathRendering,
					previewAnalysis,
					signal,
				);
				if (isRenderStale(signal)) return false;

				const didReplace = await replaceContainerContent(
					container,
					request,
					callbacks,
					signal,
					tempContainer,
					shouldSyncMathStyles,
					previewForRender.type,
					resolvePreviewRetention(previewForRender),
				);
				return didReplace;
			}

			options.onMathRenderingChange?.(true);
			await enqueueMathRender(
				async () => {
					if (isRenderStale(signal)) return;

					if (
						previewForRender.type === "text" &&
						canShareRenderedTextPreview(previewForRender.content)
					) {
						const renderedEntry =
							await sharedCache.getOrCreateRenderedTextPreviewEntry({
								cacheKey: renderKey,
								content: previewForRender.content,
								app: options.app,
								sourcePath: file.path,
								enableMathRendering: true,
								analysis: previewAnalysis,
								signal,
							});

						if (isRenderStale(signal)) return;
						const didCommit = await commitRenderedTextEntry(
							container,
							request,
							callbacks,
							signal,
							renderedEntry,
							shouldSyncMathStyles,
						);
						if (!didCommit) {
							options.onMathRenderingChange?.(false);
							return;
						}
						options.onMathRenderingChange?.(false);
						return;
					}

					const mathContainer = document.createElement("div");
					await renderPreviewContent(
						mathContainer,
						previewForRender,
						file,
						options.app,
						getOrCreateComponent,
						true,
						previewAnalysis,
						signal,
					);

					if (isRenderStale(signal)) return;
					if (
						await replaceContainerContent(
							container,
							request,
							callbacks,
							signal,
							mathContainer,
							true,
							previewForRender.type,
							resolvePreviewRetention(previewForRender),
						)
					) {
						options.onMathRenderingChange?.(false);
					}
				},
				{
					key: `${file.path}:${file.stat.mtime}:${searchQuery}`,
					priority: "high",
					signal,
				},
			);

			return !isRenderStale(signal);
		} catch (error) {
			if (signal.aborted || isAbortError(error)) return false;
			await enqueueCoordinatedDomCommit({
				targetKey: domCommitScopeKey,
				isStale: () => isRenderStale(signal),
				commit: () => {
					callbacks?.onError?.();
					return true;
				},
			});
			return false;
		}
	}

	async function applyRenderedEntry(
		container: HTMLElement,
		request: CardPreviewRequest,
		callbacks: PreviewRenderCallbacks | undefined,
		signal: AbortSignal,
	): Promise<boolean> {
		const renderedEntry = sharedCache.getRenderedPreviewCacheEntry(
			request.renderKey,
		);
		if (!renderedEntry) return false;

		const didMutateDom = await enqueueCoordinatedDomCommit({
			targetKey: domCommitScopeKey,
			isStale: () => isRenderStale(signal),
			commit: () => {
				if (!shouldSkipDomApply(container, request)) {
					container.replaceChildren(
						sharedCache.cloneRenderedPreviewContent(renderedEntry),
					);
				}
				lastAppliedRenderCacheKey = request.renderKey;
				if (renderedEntry.hasMath) {
					syncMathJaxStylesForNode(container);
				}
				callbacks?.onCommitted?.("text", "resident");
				return true;
			},
		});
		return didMutateDom || shouldSkipDomApply(container, request);
	}

	function commitRenderedTextEntry(
		container: HTMLElement,
		request: CardPreviewRequest,
		callbacks: PreviewRenderCallbacks | undefined,
		signal: AbortSignal,
		renderedEntry: RenderedTextPreviewCacheEntry,
		shouldSyncMathStyles: boolean,
	): Promise<boolean> {
		return enqueueCoordinatedDomCommit({
			targetKey: domCommitScopeKey,
			isStale: () => isRenderStale(signal),
			commit: () => {
				if (!shouldSkipDomApply(container, request)) {
					container.replaceChildren(
						sharedCache.cloneRenderedPreviewContent(renderedEntry),
					);
				}
				lastAppliedRenderCacheKey = request.renderKey;
				if (shouldSyncMathStyles) {
					syncMathJaxStylesForNode(container);
				}
				callbacks?.onCommitted?.("text", "resident");
				return true;
			},
		});
	}

	function replaceContainerContent(
		container: HTMLElement,
		request: CardPreviewRequest,
		callbacks: PreviewRenderCallbacks | undefined,
		signal: AbortSignal,
		source: HTMLElement,
		shouldSyncMathStyles: boolean,
		contentType: PreviewData["type"],
		retention: CardPreviewRetention,
	): Promise<boolean> {
		return enqueueCoordinatedDomCommit({
			targetKey: domCommitScopeKey,
			isStale: () => isRenderStale(signal),
			commit: () => {
				container.replaceChildren(moveChildrenToFragment(source));
				lastAppliedRenderCacheKey = request.renderKey;
				if (shouldSyncMathStyles) {
					syncMathJaxStylesForNode(container);
				}
				callbacks?.onCommitted?.(contentType, retention);
				return true;
			},
		});
	}

	function shouldSkipDomApply(
		container: HTMLElement,
		request: CardPreviewRequest,
	): boolean {
		return (
			lastAppliedRenderCacheKey === request.renderKey &&
			!!container.firstChild &&
			request.previewOverride?.type !== "dom"
		);
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
				previewContentIdentityKey: request.previewContentKey,
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
		request: CardPreviewRequest,
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

function resolvePreviewRetention(preview: PreviewData): CardPreviewRetention {
	if (preview.type === "dom") return "lifecycle-bound";
	if (preview.type === "text" && !canShareRenderedTextPreview(preview.content)) {
		return "lifecycle-bound";
	}
	return "resident";
}

async function renderPreviewContent(
	element: HTMLElement,
	preview: PreviewData,
	file: TFile,
	app: App,
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
		await processPreviewContent(
			element,
			preview.content,
			app,
			file.path,
			getOrCreateComponent(),
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
