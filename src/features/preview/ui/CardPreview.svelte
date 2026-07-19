<script lang="ts">
	import type { TFile } from "obsidian";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "appConstants";
	import type { PreviewData } from "ui/context/linkContext";
	import { useAppContext } from "ui/context/linkContext";
	import { getVirtualFrameCoordinatorContext } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import {
		createCardPreviewRenderer,
		type CardPreviewLoader,
	} from "./cardPreviewRenderer";
	import { createCardPreviewRenderRequestResolver } from "./cardPreviewRenderRequest";
	import SkeletonPreview from "./SkeletonPreview.svelte";

	interface Props {
		file: TFile | undefined;
		getPreview: CardPreviewLoader;
		searchQuery?: string;
		previewRefreshToken?: number;
		previewOverride?: PreviewData | null;
	}

	let {
		file,
		getPreview,
		searchQuery = "",
		previewRefreshToken = 0,
		previewOverride = null,
	}: Props = $props();
	let container = $state<HTMLDivElement | undefined>(undefined);
	let isMathRendering = $state(false);
	let hasRenderedContent = $state(false);
	let previewContentType = $state<PreviewData["type"] | undefined>(undefined);

	const { app, applicationStore, resolveSearchMatchPosition } = useAppContext();
	const resolveRenderRequest = createCardPreviewRenderRequestResolver();
	const renderPreview = createCardPreviewRenderer({
		app,
		getPreview: (targetFile, signal, options) =>
			getPreview(targetFile, signal, options),
		frameCoordinator: getVirtualFrameCoordinatorContext(),
		resolveSearchMatchPosition,
		onMathRenderingChange: (isRendering) => {
			isMathRendering = isRendering;
		},
		onPreviewContentTypeChange: (contentType) => {
			previewContentType = contentType;
		},
		onRendered: () => {
			hasRenderedContent = true;
		},
	});

	const shouldShowInitialSkeleton = $derived(isMathRendering && !hasRenderedContent);
	const previewTypeClass = $derived(
		previewContentType
			? `cosense-card-links__box-preview--${previewContentType}`
			: "",
	);
	const previewRenderRequest = $derived.by(() =>
		resolveRenderRequest(
			file,
			previewRefreshToken,
			previewOverride,
			file
				? (applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0")
				: "0:0",
			searchQuery,
			applicationStore.settings,
		),
	);

	$effect(() => {
		if (!container || !previewRenderRequest) return;
		return renderPreview(container, previewRenderRequest);
	});
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
