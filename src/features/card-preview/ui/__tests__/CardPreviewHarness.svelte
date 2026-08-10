<script lang="ts">
	import type { TFile } from "obsidian";
	import { useAppContext } from "ui/context/linkContext";
	import { getDebugDisableCardDomPreview } from "appConstants";
	import type { PreviewData } from "features/card-preview/public-types";
	import type { CardPreviewLoader } from "../cardPreviewRenderer";
	import { compileCardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
	import {
		createPreviewRuntime,
		type PreviewRuntime,
	} from "features/card-preview/runtime/previewRuntime";

	interface Props {
		getPreview: CardPreviewLoader;
		file?: TFile;
		searchQuery?: string;
		active?: boolean;
		previewOverride?: PreviewData | null;
		previewRuntime?: PreviewRuntime;
	}

	let {
		getPreview,
		file = undefined,
		searchQuery = "",
		active = true,
		previewOverride = null,
		previewRuntime: explicitPreviewRuntime = undefined,
	}: Props = $props();

	const { app, applicationStore, resolveSearchMatchPosition } = useAppContext();
	const ownsPreviewRuntime = explicitPreviewRuntime === undefined;
	const previewRuntime =
		explicitPreviewRuntime ?? createPreviewRuntime({ app, getPreview });
	const previewSurface = previewRuntime.createSurface({
		resolveSearchMatchPosition,
	});
	const slotId = "card-preview-test-slot";
	const ownerKey = "card-preview-test-owner";
	let container = $state<HTMLDivElement | undefined>(undefined);
	const request = $derived(
		file
			? compileCardPreviewRequest({
					file,
					searchQuery,
					previewOverride,
					previewRenderVersion:
						applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0",
					settings: applicationStore.settings,
				})
			: null,
	);

	$effect(() => {
		if (!container) return;
		return previewSurface.registerHost(slotId, container).dispose;
	});

	$effect(() => {
		previewSurface.beginBindings();
		if (request) previewSurface.bindSlot(slotId, 0, ownerKey, request);
		previewSurface.endBindings();
		previewSurface.setActiveRange(
			0,
			active && request ? 1 : 0,
			active && request !== null,
		);
	});

	$effect(() => () => {
		previewSurface.dispose();
		if (ownsPreviewRuntime) previewRuntime.dispose();
	});
</script>

{#if !getDebugDisableCardDomPreview()}
	<div class="cosense-card-links__box-preview" bind:this={container}></div>
{/if}
