<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import type { TFile } from "obsidian";
	import CardPreview from "ui/components/common/CardPreview.svelte";
	import {
		lazyRender,
		type LazyRenderActionParams,
	} from "ui/actions/useLazyRender";
	import {
		useAppContext,
		useLazyLoaderCache,
		useLinkContext,
	} from "ui/context/linkContext";
	import { buildPreviewGenerationKey } from "features/preview/core/previewCache";
	import {
		canActivatePreviewImmediately,
		requestPreviewActivation,
		type PreviewActivationHandle,
	} from "features/preview/scheduling/previewActivationScheduler";
	import {
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
		type PreviewActivationScope,
	} from "features/preview/scheduling/previewActivationScope";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
	import type { PreviewVisibilityMode } from "./types";
	import {
		PREVIEW_VISIBILITY_CONTEXT_KEY,
		type PreviewVisibilityContext,
	} from "./previewVisibilityContext";

	interface Props {
		file: TFile | null;
		isUnresolvedNewLink?: boolean;
		searchQuery?: string;
		searchScope?: "title-only" | "title-and-content";
		observerRoot?: HTMLElement | null;
		previewVisibilityMode?: PreviewVisibilityMode;
		previewRefreshToken?: number;
		contentPreview?: string;
	}

	let {
		file,
		isUnresolvedNewLink = false,
		searchQuery = "",
		searchScope = "title-and-content",
		observerRoot = undefined,
		previewVisibilityMode = undefined,
		previewRefreshToken = 0,
		contentPreview = undefined,
	}: Props = $props();

	const context = useLinkContext();
	const getVisiblePreviewQueueSize =
		context.getVisiblePreviewQueueSize ?? (() => 0);
	const { applicationStore } = useAppContext();
	const intersectedCache = useLazyLoaderCache();
	const previewVisibilityContext = getContext<
		PreviewVisibilityContext | undefined
	>(PREVIEW_VISIBILITY_CONTEXT_KEY);
	const previewActivationScope = getContext<
		PreviewActivationScope | undefined
	>(PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY);
	const previewMinHeight = 80;

	const visibility = $derived(previewVisibilityContext?.visibility);
	const previewOverride = $derived(
		file && file.extension !== "md" && contentPreview
			? ({ type: "text", content: contentPreview } as const)
			: null,
	);
	const settings = $derived(applicationStore.settings);
	const previewRenderVersion = $derived(
		file
			? (applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0")
			: "0:0",
	);
	const effectivePreviewCacheRevision = $derived(
		`${previewRenderVersion}:${previewRefreshToken}`,
	);
	const previewCacheKey = $derived(
		file
			? buildPreviewGenerationKey(
					file,
					settings,
					effectivePreviewCacheRevision,
				)
			: undefined,
	);
	const effectiveVisibilityMode = $derived(
		previewVisibilityMode ??
			(visibility === undefined ? "self-observed" : "controlled"),
	);
	const virtualizedVisibility = $derived(
		effectiveVisibilityMode === "controlled" ? visibility : undefined,
	);
	const previewIdentity = $derived(previewCacheKey);
	const isPreviewCached = $derived(
		previewCacheKey
			? (intersectedCache?.has(previewCacheKey) ?? false)
			: false,
	);
	let visiblePreviewIdentity = $state<string | undefined>(undefined);
	let activatedPreviewIdentity = $state<string | undefined>(undefined);
	let lastPreviewIdentity: string | undefined = undefined;
	let pendingPreviewIdentity: string | undefined = undefined;
	let activationRequest: PreviewActivationHandle | null = null;
	let activationSequence = 0;
	const shouldRenderPreview = $derived.by(() => {
		if (DEBUG_DISABLE_CARD_DOM_PREVIEW) return false;
		if (previewIdentity === undefined) return false;

		if (effectiveVisibilityMode === "controlled") {
			return (
				activatedPreviewIdentity === previewIdentity &&
				virtualizedVisibility === "visible"
			);
		}

		return isPreviewCached || visiblePreviewIdentity === previewIdentity;
	});

	function handlePreviewVisible() {
		if (!previewIdentity) return;
		visiblePreviewIdentity = previewIdentity;
	}

	function cancelPendingActivation(): void {
		activationSequence += 1;
		activationRequest?.cancel();
		activationRequest = null;
		pendingPreviewIdentity = undefined;
	}

	function resetPreviewActivationForIdentity(
		nextIdentity: string | undefined,
	): void {
		if (nextIdentity === lastPreviewIdentity) {
			return;
		}

		cancelPendingActivation();
		visiblePreviewIdentity = undefined;
		activatedPreviewIdentity = undefined;
		lastPreviewIdentity = nextIdentity;
	}

	function activateVisibleVirtualPreview(): void {
		if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
			cancelPendingActivation();
			return;
		}

		if (virtualizedVisibility !== "visible" || !previewIdentity) {
			if (pendingPreviewIdentity) {
				cancelPendingActivation();
			}
			return;
		}

		if (activatedPreviewIdentity === previewIdentity) {
			return;
		}

		if (pendingPreviewIdentity === previewIdentity) {
			return;
		}

		const identity = previewIdentity;

		if (
			canActivatePreviewImmediately(
				getVisiblePreviewQueueSize,
				previewActivationScope,
			)
		) {
			cancelPendingActivation();
			activatedPreviewIdentity = identity;
			visiblePreviewIdentity = identity;

			if (
				effectiveVisibilityMode !== "controlled" &&
				previewCacheKey &&
				intersectedCache
			) {
				intersectedCache.add(previewCacheKey);
			}
			return;
		}

		cancelPendingActivation();

		const request = requestPreviewActivation(
			identity,
			getVisiblePreviewQueueSize,
			previewActivationScope,
		);
		const sequence = ++activationSequence;

		activationRequest = request;
		pendingPreviewIdentity = identity;

		request.promise.then((activated) => {
			if (activationRequest === request) {
				activationRequest = null;
				pendingPreviewIdentity = undefined;
			}

			if (!activated) {
				return;
			}
			if (activationSequence !== sequence) {
				return;
			}
			if (previewIdentity !== identity) {
				return;
			}
			if (virtualizedVisibility !== "visible") {
				return;
			}

			activatedPreviewIdentity = identity;
			visiblePreviewIdentity = identity;

			if (
				effectiveVisibilityMode !== "controlled" &&
				previewCacheKey &&
				intersectedCache
			) {
				intersectedCache.add(previewCacheKey);
			}
		});
	}

	const previewLazyParams = $derived.by(
		(): LazyRenderActionParams => ({
			cacheKey: previewCacheKey,
			rootMargin: "50px",
			threshold: 0,
			intersectedCache,
			observerRoot,
			onVisible: handlePreviewVisible,
		}),
	);

	$effect(() => {
		resetPreviewActivationForIdentity(previewIdentity);
	});

	$effect(() => {
		activateVisibleVirtualPreview();
	});

	onDestroy(() => {
		cancelPendingActivation();
	});
</script>

{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW && isUnresolvedNewLink && !file}
	<div
		class="unresolved-preview-placeholder"
		data-ccl-vlist-ignore-structure
		inert
		aria-hidden="true"
	></div>
{:else if !DEBUG_DISABLE_CARD_DOM_PREVIEW && file}
	{#if effectiveVisibilityMode === "self-observed"}
		<div
			use:lazyRender={previewLazyParams}
			class="preview-mount-slot"
			data-ccl-vlist-ignore-structure
			style:min-height={`${previewMinHeight}px`}
			aria-hidden="true"
		>
			{#if shouldRenderPreview}
				<CardPreview
					{file}
					getPreview={context.getPreview}
					searchQuery={searchScope === "title-only"
						? ""
						: searchQuery}
					{previewRefreshToken}
					{previewOverride}
				/>
			{:else}
				<div class="lazy-placeholder"></div>
			{/if}
		</div>
	{:else if shouldRenderPreview}
		<CardPreview
			{file}
			getPreview={context.getPreview}
			searchQuery={searchScope === "title-only" ? "" : searchQuery}
			{previewRefreshToken}
			{previewOverride}
		/>
	{/if}
{/if}

<style>
	.unresolved-preview-placeholder {
		--bar-color: var(--color-base-20);
		flex: 1 1 auto;
		height: 61px;
		min-height: 61px;
		margin: 10px var(--ccl-box-padding) 0;
		border-radius: 2px;
		background-image: linear-gradient(var(--bar-color), var(--bar-color)),
			linear-gradient(var(--bar-color), var(--bar-color)),
			linear-gradient(var(--bar-color), var(--bar-color)),
			linear-gradient(var(--bar-color), var(--bar-color)),
			linear-gradient(var(--bar-color), var(--bar-color));
		background-repeat: no-repeat;
		background-size:
			100% 5px,
			100% 5px,
			100% 5px,
			100% 5px,
			70% 5px;
		background-position:
			0 0,
			0 14px,
			0 28px,
			0 42px,
			0 56px;
		opacity: 0.55;
	}
</style>
