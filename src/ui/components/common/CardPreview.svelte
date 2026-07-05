<script lang="ts">
	import { Component } from "obsidian";
	import type { TFile } from "obsidian";
	import type { PreviewData, PreviewRequestOptions } from "ui/context/linkContext";
	import { useAppContext } from "ui/context/linkContext";
	import { DEFAULT_SETTINGS, type PluginSettings } from "types/settings";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
	import { processPreviewContent } from "../../../features/preview/renderers/markdownPreviewRenderer";
	import { toPreviewImageSrc } from "../../../features/preview/utils/externalFileImage";
	import { enqueueMathRender } from "features/preview/renderers/mathRenderQueue";
	import { createPreviewOverrideIdentity } from "features/preview/core/previewRenderIdentity";
	import type { PreviewContentAnalysis } from "features/preview/utils/previewUtils";
	import SkeletonPreview from "./SkeletonPreview.svelte";
	import {
		applySharedSearchContextToTextPreview,
		buildPreviewRenderKeys,
		canShareRenderedTextPreview,
		cloneRenderedPreviewContent,
		getOrCreateRenderedTextPreviewEntry,
		getRenderedPreviewCacheEntry,
		getSharedPreviewAnalysis,
		normalizePreviewQuery,
		type PreviewSearchContext,
	} from "./cardPreviewSharedCache";
	import { nextAnimationFrame } from "ui/utils/frame";
	import { syncMathJaxStylesForNode } from "ui/utils/mathJaxShadowStyles";

	interface Props {
		file: TFile | undefined;
		getPreview: (
			file: TFile,
			signal?: AbortSignal,
			options?: PreviewRequestOptions,
		) => Promise<PreviewData>;
		searchQuery?: string;
		previewRefreshToken?: number;
		previewOverride?: PreviewData | null;
	}

	interface PreviewRenderRequest {
		file: TFile;
		previewCacheRevision: string;
		previewContentIdentityKey: string;
		renderCacheKey: string;
		previewOverride: PreviewData | null;
		searchQuery: string;
		settings: PluginSettings;
	}

	let {
		file,
		getPreview,
		searchQuery = "",
		previewRefreshToken = 0,
		previewOverride = null,
	}: Props = $props();
	let container = $state<HTMLDivElement | undefined>(undefined);
	const { app, applicationStore, resolveSearchMatchPosition } = useAppContext();

	let lastPreviewRenderRequest: PreviewRenderRequest | null = null;
	let lastPreviewRenderDomOverride: PreviewData | null = null;
	let renderSequence = 0;

	let isMathRendering = $state(false);
	let hasRenderedContent = $state(false);
	let lastAppliedRenderCacheKey: string | undefined = undefined;
	const shouldShowInitialSkeleton = $derived(isMathRendering && !hasRenderedContent);
	let previewContentType = $state<PreviewData["type"] | undefined>(undefined);
	const previewTypeClass = $derived(
		previewContentType
			? `cosense-card-links__box-preview--${previewContentType}`
			: "",
	);

	const previewRenderRequest = $derived.by((): PreviewRenderRequest | null => {
		if (!file) {
			lastPreviewRenderRequest = null;
			lastPreviewRenderDomOverride = null;
			return null;
		}

		const settings = createPreviewRenderSettings(applicationStore.settings);
		const previewRenderVersion =
			applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0";
		const effectivePreviewRenderVersion = `${previewRenderVersion}:${previewRefreshToken}`;
		const previewOverrideIdentity = createPreviewOverrideIdentity(previewOverride);
		const renderVersionIdentity = `${effectivePreviewRenderVersion}:${previewOverrideIdentity}`;
		const { previewContentIdentityKey, renderCacheKey } = buildPreviewRenderKeys(
			file,
			searchQuery,
			settings,
			renderVersionIdentity,
		);
		const domPreviewOverride =
			previewOverride?.type === "dom" ? previewOverride : null;

		if (
			lastPreviewRenderRequest &&
			lastPreviewRenderRequest.renderCacheKey === renderCacheKey &&
			lastPreviewRenderDomOverride === domPreviewOverride
		) {
			return lastPreviewRenderRequest;
		}

		lastPreviewRenderDomOverride = domPreviewOverride;
		lastPreviewRenderRequest = {
			file,
			previewCacheRevision: effectivePreviewRenderVersion,
			previewContentIdentityKey,
			renderCacheKey,
			previewOverride,
			searchQuery,
			settings,
		};
		return lastPreviewRenderRequest;
	});

	function createPreviewRenderSettings(settings: PluginSettings): PluginSettings {
		return {
			...DEFAULT_SETTINGS,
			cardHeightRatio: settings.cardHeightRatio,
			cardWidthPx: settings.cardWidthPx,
			previewMaxChars: settings.previewMaxChars,
			previewMaxLines: settings.previewMaxLines,
			previewVisualLineSafetyMargin: settings.previewVisualLineSafetyMargin,
			priorityFrontmatterKeyForPreview: settings.priorityFrontmatterKeyForPreview,
			renderCodeBlockTypes: settings.renderCodeBlockTypes,
			searchPreviewSeekBufferChars: settings.searchPreviewSeekBufferChars,
			searchPreviewSeekThresholdChars: settings.searchPreviewSeekThresholdChars,
		};
	}

	function renderCurrentPreview(request: PreviewRenderRequest): () => void {
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
		const queryForRender = request.searchQuery;

		renderPreview(
			request.file,
			abortController.signal,
			getOrCreateComponent,
			renderToken,
			queryForRender,
			request.previewCacheRevision,
			request.previewContentIdentityKey,
			request.renderCacheKey,
			request.previewOverride,
			request.settings,
		).then((didRender) => {
			if (
				didRender &&
				!abortController.signal.aborted &&
				renderToken === renderSequence
			) {
				hasRenderedContent = true;
			}
		});

		return () => {
			abortController.abort();
			component?.unload();

			// cleanup では abort/unload のみ行う。
			// DOM クリアは再描画が必要と判定できた時点で実施し、
			// noop 再評価での不要な空表示を避ける。
		};
	}

	$effect(() => {
		if (!container || !previewRenderRequest) {
			return;
		}

		return renderCurrentPreview(previewRenderRequest);
	});

	function isRenderStale(signal: AbortSignal, renderToken: number): boolean {
		return signal.aborted || renderToken !== renderSequence;
	}

	function isAbortError(error: unknown): boolean {
		return error instanceof DOMException
			? error.name === "AbortError"
			: error instanceof Error && error.name === "AbortError";
	}

	function shouldSkipDomApply(renderCacheKey: string): boolean {
		return (
			lastAppliedRenderCacheKey === renderCacheKey &&
			!!container?.firstChild &&
			lastPreviewRenderDomOverride === null
		);
	}

	async function replaceContainerContent(
		source: HTMLElement,
		signal: AbortSignal,
		renderToken: number,
		renderCacheKey: string,
		shouldSyncMathJaxStyles = false,
	): Promise<boolean> {
		await nextAnimationFrame();
		if (isRenderStale(signal, renderToken) || !container) return false;
		if (shouldSkipDomApply(renderCacheKey)) return true;
		container.replaceChildren();
		while (source.firstChild) {
			container.appendChild(source.firstChild);
		}
		lastAppliedRenderCacheKey = renderCacheKey;

		if (shouldSyncMathJaxStyles) {
			syncMathJaxStylesForNode(container);
		}
		return true;
	}

	async function applyRenderedEntry(
		container: HTMLElement,
		cacheKey: string,
		signal: AbortSignal,
		renderToken: number,
	): Promise<boolean> {
		const renderedEntry = getRenderedPreviewCacheEntry(cacheKey);
		if (!renderedEntry) {
			return false;
		}

		await nextAnimationFrame();
		if (isRenderStale(signal, renderToken)) return false;
		if (shouldSkipDomApply(cacheKey)) return true;
		previewContentType = "text";
		container.replaceChildren(cloneRenderedPreviewContent(renderedEntry));
		lastAppliedRenderCacheKey = cacheKey;
		if (renderedEntry.hasMath) {
			syncMathJaxStylesForNode(container);
		}
		return true;
	}

	function shouldSyncMathJaxStyles(
		enableMathRendering: boolean,
		analysis?: PreviewContentAnalysis,
	): boolean {
		return enableMathRendering && analysis?.hasMathExpression === true;
	}

	async function renderPreview(
		targetFile: TFile,
		signal: AbortSignal,
		getOrCreateComponent: () => Component,
		renderToken: number,
		queryForRender: string,
		previewCacheRevision: string,
		previewContentIdentityKey: string,
		renderCacheKey: string,
		previewOverride: PreviewData | null,
		settings: PluginSettings,
	): Promise<boolean> {
		try {
			if (
				container &&
				(await applyRenderedEntry(
					container,
					renderCacheKey,
					signal,
					renderToken,
				))
			) {
				isMathRendering = false;
				return true;
			}

			const preview = previewOverride
				? normalizePreviewData(previewOverride)
				: normalizePreviewData(
						await getPreview(targetFile, signal, {
							cacheRevision: previewCacheRevision,
						}),
					);

			const previewForRender = await applySearchContextToPreview(
				preview,
				targetFile,
				signal,
				queryForRender,
				previewContentIdentityKey,
				settings,
			);

			if (isRenderStale(signal, renderToken)) return false;

			const enableMathRendering =
				normalizePreviewQuery(queryForRender).length === 0;
			const previewAnalysis =
				enableMathRendering &&
				previewForRender.type === "text" &&
				previewForRender.content.includes("$")
					? getPreviewAnalysis(renderCacheKey, previewForRender.content)
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
					isMathRendering = false;

					if (canShareRenderedTextPreview(previewForRender.content)) {
						const renderedEntry = await getOrCreateRenderedTextPreviewEntry(
							{
								cacheKey: renderCacheKey,
								content: previewForRender.content,
								app,
								sourcePath: targetFile.path,
								enableMathRendering,
								analysis: previewAnalysis,
								signal,
							},
						);

						if (isRenderStale(signal, renderToken)) return false;
						if (!container) return false;
						await nextAnimationFrame();
						if (isRenderStale(signal, renderToken)) return false;
						if (shouldSkipDomApply(renderCacheKey)) return true;
						previewContentType = previewForRender.type;
						container.replaceChildren(
							cloneRenderedPreviewContent(renderedEntry),
						);
						lastAppliedRenderCacheKey = renderCacheKey;
						if (shouldSyncMathStyles) {
							syncMathJaxStylesForNode(container);
						}
						return true;
					}

					const tempContainer = document.createElement("div");
					await renderPreviewContent(
						tempContainer,
						previewForRender,
						targetFile.basename,
						app,
						targetFile.path,
						getOrCreateComponent(),
						enableMathRendering,
						previewAnalysis,
						signal,
					);
					if (isRenderStale(signal, renderToken)) return false;
					const didReplace = await replaceContainerContent(
						tempContainer,
						signal,
						renderToken,
						renderCacheKey,
						shouldSyncMathStyles,
					);
					if (didReplace) {
						previewContentType = previewForRender.type;
					}
					return didReplace;
				}

				if (previewForRender.type === "image") {
					isMathRendering = false;
					await nextAnimationFrame();
					if (isRenderStale(signal, renderToken) || !container) return false;
					if (shouldSkipDomApply(renderCacheKey)) return true;

					const img = document.createElement("img");
					img.alt = `preview for ${targetFile.basename}`;
					img.loading = "lazy";
					img.decoding = "async";
					img.fetchPriority = "low";
					img.src = toPreviewImageSrc(previewForRender.content);

					previewContentType = "image";
					container.replaceChildren(img);
					lastAppliedRenderCacheKey = renderCacheKey;
					return true;
				}

				// 数式がなければ従来どおり即時反映
				isMathRendering = false;
				const tempContainer = document.createElement("div");
				await renderPreviewContent(
					tempContainer,
					previewForRender,
					targetFile.basename,
					app,
					targetFile.path,
					getOrCreateComponent(),
					enableMathRendering,
					previewAnalysis,
					signal,
				);

				if (isRenderStale(signal, renderToken)) return false;
				const didReplace = await replaceContainerContent(
					tempContainer,
					signal,
					renderToken,
					renderCacheKey,
					shouldSyncMathStyles,
				);
				if (didReplace) {
					previewContentType = previewForRender.type;
				}
				return didReplace;
			}

			// 数式がある場合、スケルトンを表示してからレンダリング
			isMathRendering = true;

			await enqueueMathRender(
				async () => {
					if (isRenderStale(signal, renderToken)) {
						return;
					}

					if (previewForRender.type === "text") {
						if (canShareRenderedTextPreview(previewForRender.content)) {
							const renderedEntry =
								await getOrCreateRenderedTextPreviewEntry({
									cacheKey: renderCacheKey,
									content: previewForRender.content,
									app,
									sourcePath: targetFile.path,
									enableMathRendering: true,
									analysis: previewAnalysis,
									signal,
								});

							if (isRenderStale(signal, renderToken)) {
								return;
							}

							if (!container) {
								isMathRendering = false;
								return;
							}

							await nextAnimationFrame();
							if (isRenderStale(signal, renderToken)) {
								return;
							}
							if (shouldSkipDomApply(renderCacheKey)) {
								isMathRendering = false;
								return;
							}
							previewContentType = previewForRender.type;
							container.replaceChildren(
								cloneRenderedPreviewContent(renderedEntry),
							);
							lastAppliedRenderCacheKey = renderCacheKey;
							if (shouldSyncMathStyles) {
								syncMathJaxStylesForNode(container);
							}
							isMathRendering = false;
							return;
						}
					}

					const mathContainer = document.createElement("div");
					await renderPreviewContent(
						mathContainer,
						previewForRender,
						targetFile.basename,
						app,
						targetFile.path,
						getOrCreateComponent(),
						true,
						previewAnalysis,
						signal,
					);

					if (isRenderStale(signal, renderToken)) {
						return;
					}

					if (
						await replaceContainerContent(
							mathContainer,
							signal,
							renderToken,
							renderCacheKey,
							true,
						)
					) {
						previewContentType = previewForRender.type;
						isMathRendering = false;
					}
				},
				{
					key: `${targetFile.path}:${targetFile.stat.mtime}:${queryForRender}`,
					priority: "high",
					signal,
				},
			);

			return !isRenderStale(signal, renderToken);
		} catch (error) {
			if (signal.aborted || isAbortError(error) || !container) {
				return false;
			}
			previewContentType = undefined;
			handlePreviewError(container, error);
			return false;
		}
	}

	async function applySearchContextToPreview(
		preview: PreviewData,
		targetFile: TFile,
		signal: AbortSignal,
		queryForRender: string,
		previewContentIdentityKey: string,
		settings: PluginSettings,
	): Promise<PreviewData> {
		if (preview.type !== "text") {
			return preview;
		}

		const normalizedQuery = normalizePreviewQuery(queryForRender);
		if (!normalizedQuery) {
			return preview;
		}

		const contentForRender = await applySharedSearchContextToTextPreview({
			previewContent: preview.content,
			previewContentIdentityKey,
			targetFile,
			normalizedQuery,
			searchContext: () => buildPreviewSearchContext(queryForRender, targetFile),
			settings,
			vault: app.vault,
			signal,
		});
		if (signal.aborted) {
			return preview;
		}

		return {
			...preview,
			content: contentForRender,
		};
	}

	function buildPreviewSearchContext(
		queryForRender: string,
		targetFile: TFile,
	): PreviewSearchContext {
		const firstMatchOffset = resolveSearchMatchPosition?.(
			queryForRender,
			targetFile,
		)?.start.offset;

		return {
			query: queryForRender,
			...(typeof firstMatchOffset === "number" && firstMatchOffset >= 0
				? { firstMatchOffset }
				: {}),
		};
	}

	function normalizePreviewData(preview: unknown): PreviewData {
		if (isPreviewData(preview)) {
			return preview;
		}

		return {
			type: "empty",
			content: "",
		};
	}

	function isPreviewData(preview: unknown): preview is PreviewData {
		if (!preview || typeof preview !== "object") {
			return false;
		}

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

	async function renderPreviewContent(
		element: HTMLElement,
		preview: PreviewData,
		basename: string,
		app: any,
		sourcePath: string,
		component: Component,
		enableMathRendering: boolean,
		analysis?: PreviewContentAnalysis,
		signal?: AbortSignal,
	) {
		if (signal?.aborted) {
			return;
		}

		if (preview.type === "image") {
			element.createEl("img", {
				attr: {
					alt: `preview for ${basename}`,
					loading: "lazy",
					decoding: "async",
					fetchpriority: "low",
					src: toPreviewImageSrc(preview.content),
				},
			});
		} else if (preview.type === "dom") {
			if (signal?.aborted) {
				return;
			}
			await preview.render(element, component, signal);
		} else if (preview.type === "text") {
			await processPreviewContent(
				element,
				preview.content,
				app,
				sourcePath,
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

	function getPreviewAnalysis(
		cacheKey: string,
		content: string,
	): PreviewContentAnalysis {
		return getSharedPreviewAnalysis(cacheKey, content);
	}

	function handlePreviewError(element: HTMLElement, error: unknown) {
		console.error("Preview error:", error);
		element.replaceChildren();
		const errorDiv = document.createElement("div");
		errorDiv.className = "error";
		errorDiv.textContent = "Preview not available.";
		element.appendChild(errorDiv);
	}
</script>

{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW}
	{#if shouldShowInitialSkeleton}
		<SkeletonPreview />
	{/if}
	<div
		class="cosense-card-links__box-preview {previewTypeClass}"
		bind:this={container}
		class:hidden={shouldShowInitialSkeleton}
	></div>
{/if}
