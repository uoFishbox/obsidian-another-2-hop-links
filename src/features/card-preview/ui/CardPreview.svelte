<script lang="ts">
	import { getDebugDisableCardDomPreview } from "appConstants";
	import { useAppContext } from "ui/context/linkContext";
	import { getVirtualFrameCoordinatorContext } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
	import type {
		PreviewRuntime,
		PreviewRuntimeRendererOptions,
	} from "features/card-preview/runtime/previewRuntime";
	import SkeletonPreview from "./SkeletonPreview.svelte";
	import {
		createPreviewSlotController,
		type PreviewSlotController,
	} from "./previewSlotController";

	interface Props {
		request: CardPreviewRequest | null;
		/** Explicit runtime boundary used by isolated consumers and tests. */
		previewRuntime?: PreviewRuntime;
	}

	let { request, previewRuntime: explicitPreviewRuntime }: Props = $props();
	let container = $state<HTMLDivElement | undefined>(undefined);
	// The controller owns the host's data attributes and state classes; Svelte
	// only tracks whether the MathJax initial skeleton should be visible.
	let shouldShowInitialSkeleton = $state(false);
	let controller: PreviewSlotController;

	const {
		applicationStore,
		previewRuntime: contextPreviewRuntime,
		resolveSearchMatchPosition,
	} = useAppContext();
	const previewRuntime = explicitPreviewRuntime ?? contextPreviewRuntime;
	if (!previewRuntime) {
		throw new TypeError("CardPreview requires a PreviewRuntime");
	}
	const rendererOptions: PreviewRuntimeRendererOptions = {
		frameCoordinator: getVirtualFrameCoordinatorContext(),
		getDomCommitsPerSecond: () =>
			applicationStore.settings.previewDomCommitsPerSecond,
		resolveSearchMatchPosition,
		onMathRenderingChange: (isRendering) => {
			controller?.setMathRendering(isRendering);
		},
	};
	const renderPreview = previewRuntime.createRenderer(rendererOptions);

	// A single-preview host owns exactly one card, so a constant owner key is
	// sufficient: rebind is driven by the request render key.
	const ownerKey = "card-preview-single";
	controller = createPreviewSlotController({
		createRenderer: () => renderPreview,
		onStateChange: (state) => {
			const next = state.isMathRendering && !state.hasContent;
			if (next !== shouldShowInitialSkeleton) {
				shouldShowInitialSkeleton = next;
			}
		},
	});

	$effect(() => {
		if (!container) return;
		return controller.attachHost(container).dispose;
	});

	$effect(() => {
		controller.bind(request ? { ownerKey, request } : null);
		controller.setActive(request !== null);
		// This component is the immediate path for a single or small number of
		// cards. Bulk surfaces must register hosts with VirtualPreviewSurface so
		// activation remains subject to runtime admission and fairness.
		if (request) controller.activate();
	});

	$effect(() => controller.dispose);
</script>

{#if !getDebugDisableCardDomPreview()}
	{#if shouldShowInitialSkeleton}
		<SkeletonPreview />
	{/if}
	<div
		class="cosense-card-links__box-preview"
		bind:this={container}
		class:hidden={shouldShowInitialSkeleton}
	></div>
{/if}
