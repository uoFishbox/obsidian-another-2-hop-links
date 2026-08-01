<script lang="ts">
	import { getDebugDisableCardDomPreview } from "appConstants";
	import { useAppContext } from "ui/context/linkContext";
	import { getVirtualFrameCoordinatorContext } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
	import type {
		PreviewRuntime,
		PreviewRuntimeRendererOptions,
	} from "features/preview/runtime/previewRuntime";
	import SkeletonPreview from "./SkeletonPreview.svelte";
	import {
		createPreviewSlotController,
		type PreviewSlotController,
		type PreviewSlotState,
	} from "./previewSlotController";

	interface Props {
		request: CardPreviewRequest | null;
		/** Explicit runtime boundary used by isolated consumers and tests. */
		previewRuntime?: PreviewRuntime;
	}

	let { request, previewRuntime: explicitPreviewRuntime }: Props = $props();
	let container = $state<HTMLDivElement | undefined>(undefined);
	let slotState = $state<PreviewSlotState>({
		phase: "empty",
		hasContent: false,
		isMathRendering: false,
	});
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
		onCommitted: () => {},
		onRendered: () => {},
	};
	const renderPreview = previewRuntime.createRenderer(rendererOptions);

	const ownerToken = {};
	controller = createPreviewSlotController({
		createRenderer: () => renderPreview,
		onStateChange: (nextState) => {
			slotState = nextState;
		},
	});
	const shouldShowInitialSkeleton = $derived(
		slotState.isMathRendering && !slotState.hasContent,
	);
	const previewTypeClass = $derived(
		slotState.contentType
			? `cosense-card-links__box-preview--${slotState.contentType}`
			: "",
	);
	const isStale = $derived(
		slotState.phase === "stale" || slotState.phase === "dormant",
	);

	$effect(() => {
		if (!container) return;
		return controller.attachHost(container).dispose;
	});

	$effect(() => {
		controller.bind(request ? { ownerToken, request } : null);
		controller.setActive(request !== null);
		// This component is the immediate path for a single or small number of
		// cards. Bulk surfaces must use PreviewHost and VirtualPreviewSurface so
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
		class="cosense-card-links__box-preview {previewTypeClass}"
		bind:this={container}
		class:hidden={shouldShowInitialSkeleton}
		class:is-stale={isStale}
	></div>
{/if}
