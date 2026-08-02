<script lang="ts">
	import type { TFile } from "obsidian";
	import { useAppContext } from "ui/context/linkContext";
	import type { PreviewData } from "features/preview/public-types";
	import type { CardPreviewLoader } from "../cardPreviewRenderer";
	import { compileCardPreviewRequest } from "features/preview/core/cardPreviewRequest";
	import {
		createPreviewRuntime,
		type PreviewRuntime,
	} from "features/preview/runtime/previewRuntime";
	import CardPreview from "../CardPreview.svelte";

	interface Props {
		getPreview: CardPreviewLoader;
		file?: TFile;
		searchQuery?: string;
		previewRefreshToken?: number;
		previewOverride?: PreviewData | null;
		previewRuntime?: PreviewRuntime;
	}

	let {
		getPreview,
		file = undefined,
		searchQuery = "",
		previewRefreshToken = 0,
		previewOverride = null,
		previewRuntime: explicitPreviewRuntime = undefined,
	}: Props = $props();

	const { app, applicationStore } = useAppContext();
	const ownsPreviewRuntime = explicitPreviewRuntime === undefined;
	const previewRuntime =
		explicitPreviewRuntime ?? createPreviewRuntime({ app, getPreview });
	const request = $derived(
		file
			? compileCardPreviewRequest({
					file,
					searchQuery,
					previewRefreshToken,
					previewOverride,
					previewRenderVersion:
						applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0",
					settings: applicationStore.settings,
				})
			: null,
	);

	$effect(() => {
		if (!ownsPreviewRuntime) return;
		return previewRuntime.dispose;
	});
</script>

<CardPreview {request} {previewRuntime} />
