<script lang="ts">
	import type { TFile } from "obsidian";
	import { untrack } from "svelte";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "appConstants";
	import type { PreviewData } from "ui/context/linkContext";
	import { useAppContext } from "ui/context/linkContext";
	import { getVirtualFrameCoordinatorContext } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import type { CardPreviewSnapshot } from "./cardPreviewSnapshot";
	import {
		createCardPreviewRenderer,
		type CardPreviewLoader,
		type CardPreviewRetention,
	} from "./cardPreviewRenderer";
	import { createCardPreviewRenderRequestResolver } from "./cardPreviewRenderRequest";
	import SkeletonPreview from "./SkeletonPreview.svelte";

	interface Props {
		bindingIdentity?: string;
		renderSnapshot?: CardPreviewSnapshot;
		getPreview: CardPreviewLoader;
		/** @deprecated Use renderSnapshot. Retained for non-virtual callers. */
		file?: TFile;
		/** @deprecated Use renderSnapshot. */
		searchQuery?: string;
		/** @deprecated Use renderSnapshot. */
		previewRefreshToken?: number;
		/** @deprecated Use renderSnapshot. */
		previewOverride?: PreviewData | null;
	}

	let {
		bindingIdentity = undefined,
		renderSnapshot = undefined,
		getPreview,
		file = undefined,
		searchQuery = "",
		previewRefreshToken = 0,
		previewOverride = null,
	}: Props = $props();
	let container = $state<HTMLDivElement | undefined>(undefined);
	let isMathRendering = $state(false);
	let hasRenderedContent = $state(false);
	let previewContentType = $state<PreviewData["type"] | undefined>(undefined);
	let committedIdentity = $state<string | undefined>(undefined);
	let committedRetention = $state<CardPreviewRetention | undefined>(undefined);
	let isCommittedDormant = $state(false);
	let lifecycleCleanupHandle: number | undefined;

	const { app, applicationStore, resolveSearchMatchPosition } = useAppContext();
	const resolveRenderRequest = createCardPreviewRenderRequestResolver();
	const effectiveBindingIdentity = $derived(
		bindingIdentity ?? renderSnapshot?.identity ?? file?.path ?? "",
	);
	const effectiveRenderSnapshot = $derived.by(() => {
		if (renderSnapshot) return renderSnapshot;
		if (!file) return undefined;
		return {
			identity: effectiveBindingIdentity,
			file,
			searchQuery,
			previewRefreshToken,
			previewOverride,
		} satisfies CardPreviewSnapshot;
	});
	const renderPreview = createCardPreviewRenderer({
		app,
		getPreview: (targetFile, signal, options) =>
			getPreview(targetFile, signal, options),
		frameCoordinator: getVirtualFrameCoordinatorContext(),
		resolveSearchMatchPosition,
		onMathRenderingChange: (isRendering) => {
			isMathRendering = isRendering;
		},
		onCommitted: (identity, contentType, retention) => {
			committedIdentity = identity;
			committedRetention = retention;
			previewContentType = contentType;
			isCommittedDormant = false;
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
	const previewRenderRequest = $derived.by(() => {
		const snapshot = effectiveRenderSnapshot;
		return resolveRenderRequest(
			snapshot?.file,
			snapshot?.previewRefreshToken ?? 0,
			snapshot?.previewOverride ?? null,
			snapshot
				? (applicationStore.getPreviewRenderVersion?.(snapshot.file.path) ??
						"0:0")
				: "0:0",
			snapshot?.searchQuery ?? "",
			applicationStore.settings,
		);
	});
	const isStale = $derived(
		committedIdentity !== effectiveBindingIdentity || isCommittedDormant,
	);

	function cancelLifecycleCleanup(): void {
		if (lifecycleCleanupHandle === undefined) return;
		cancelIdleCallback(lifecycleCleanupHandle);
		lifecycleCleanupHandle = undefined;
	}

	function scheduleLifecycleCleanup(identity: string): void {
		cancelLifecycleCleanup();
		lifecycleCleanupHandle = requestIdleCallback(() => {
			lifecycleCleanupHandle = undefined;
			if (!container || committedIdentity !== identity) return;
			if (effectiveRenderSnapshot?.identity === identity) return;
			container.replaceChildren();
		});
	}

	$effect(() => {
		if (!container) return;

		const request = previewRenderRequest;
		const identity = effectiveBindingIdentity;
		if (!request) {
			isMathRendering = false;
			const retention = untrack(() => committedRetention);
			const committed = untrack(() => committedIdentity);
			if (retention === "lifecycle-bound" && committed) {
				isCommittedDormant = true;
				scheduleLifecycleCleanup(committed);
			}
			return;
		}

		cancelLifecycleCleanup();
		const committed = untrack(() => committedIdentity);
		const retention = untrack(() => committedRetention);
		if (
			bindingIdentity !== undefined &&
			committed === identity &&
			retention === "resident"
		) {
			return;
		}

		return renderPreview(container, request, identity);
	});

	$effect(() => cancelLifecycleCleanup);
</script>

{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW}
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
