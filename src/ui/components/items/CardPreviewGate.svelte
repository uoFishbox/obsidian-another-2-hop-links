<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import type { TFile } from "obsidian";
	import type { PreviewData } from "ui/context/linkContext";
	import CardPreview from "ui/components/common/CardPreview.svelte";
	import { lazyRender, type LazyRenderActionParams } from "ui/actions/useLazyRender";
	import {
		useAppContext,
		useLazyLoaderCache,
		useLinkContext,
	} from "ui/context/linkContext";
	import { buildPreviewGenerationKey } from "features/preview/core/previewCache";
	import {
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
		type PreviewActivationScope,
	} from "features/preview/scheduling/previewActivationScope";
	import {
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
		type RowPreviewActivationRuntime,
	} from "features/preview/scheduling/rowPreviewActivationRuntime";
	import {
		requestPreviewActivation,
		requestQueuedPreviewActivation,
		type PreviewActivationHandle,
	} from "features/preview/scheduling/previewActivationScheduler";
	import { buildCardPreviewActivationIdentity } from "features/preview/core/cardPreviewActivationIdentity";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
	import type { PreviewVisibilityMode } from "./types";
	import {
		PREVIEW_VISIBILITY_CONTEXT_KEY,
		type PreviewVisibilityContext,
	} from "./previewVisibilityContext";

	let nextCardPreviewGateId = 0;

	interface RenderedPreviewSnapshot {
		readonly identity: string;
		readonly file: TFile;
		readonly searchQuery: string;
		readonly previewRefreshToken: number;
		readonly previewOverride: PreviewData | null;
	}

	interface Props {
		file: TFile | null;
		isUnresolvedNewLink?: boolean;
		searchQuery?: string;
		searchScope?: "title-only" | "title-and-content";
		observerRoot?: HTMLElement | null;
		previewVisibilityMode?: PreviewVisibilityMode;
		previewRefreshToken?: number;
		contentPreview?: string;
		rowIndex?: number;
		activationCandidateId?: string;
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
		rowIndex = undefined,
		activationCandidateId = undefined,
	}: Props = $props();

	const context = useLinkContext();
	const getVisiblePreviewQueueSize = context.getVisiblePreviewQueueSize ?? (() => 0);
	const { applicationStore } = useAppContext();
	const intersectedCache = useLazyLoaderCache();
	const previewVisibilityContext = getContext<PreviewVisibilityContext | undefined>(
		PREVIEW_VISIBILITY_CONTEXT_KEY,
	);
	const previewActivationScope = getContext<PreviewActivationScope | undefined>(
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
	);
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
	const previewMinHeight = 80;

	const visibility = $derived(previewVisibilityContext?.visibility);
	const previewOverride: PreviewData | null = $derived(
		file && file.extension !== "md" && contentPreview
			? ({ type: "text", content: contentPreview } as const)
			: null,
	);
	const settings = $derived(applicationStore.settings);
	const previewRenderVersion = $derived(
		file ? (applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0") : "0:0",
	);
	const effectivePreviewCacheRevision = $derived(
		`${previewRenderVersion}:${previewRefreshToken}`,
	);
	const previewCacheKey = $derived(
		file
			? buildPreviewGenerationKey(file, settings, effectivePreviewCacheRevision)
			: undefined,
	);
	const effectiveVisibilityMode = $derived(
		previewVisibilityMode ??
			(visibility === undefined ? "self-observed" : "controlled"),
	);
	const virtualizedVisibility = $derived(
		effectiveVisibilityMode === "controlled" ? visibility : undefined,
	);
	const previewIdentity = $derived(
		file
			? buildCardPreviewActivationIdentity({
					file,
					settings,
					searchQuery,
					searchScope,
					previewRenderVersion,
					previewRefreshToken,
					previewOverride,
				})
			: undefined,
	);
	const isPreviewCached = $derived(
		previewCacheKey ? (intersectedCache?.has(previewCacheKey) ?? false) : false,
	);
	let visiblePreviewIdentity = $state<string | undefined>(undefined);
	let activatedPreviewIdentity = $state<string | undefined>(undefined);
	let lastPreviewIdentity: string | undefined = undefined;
	let pendingPreviewIdentity: string | undefined = undefined;
	let activationRequest: PreviewActivationHandle | null = null;
	let activationSequence = 0;
	let unregisterRowActivationCandidate: (() => void) | undefined = undefined;
	let registeredRowActivationCandidateId: string | undefined = undefined;
	let registeredRowActivationCandidateSignature: string | undefined = undefined;
	const fallbackCandidateId = `card-preview-gate:${++nextCardPreviewGateId}`;

	let renderedPreviewSnapshot = $state<RenderedPreviewSnapshot | undefined>(
		undefined,
	);

	const currentPreviewSnapshot = $derived.by(
		(): RenderedPreviewSnapshot | undefined => {
			if (!file || !previewIdentity) {
				return undefined;
			}

			return {
				identity: previewIdentity,
				file,
				searchQuery: searchScope === "title-only" ? "" : searchQuery,
				previewRefreshToken,
				previewOverride,
			};
		},
	);

	const shouldRenderPreview = $derived.by(() => {
		if (DEBUG_DISABLE_CARD_DOM_PREVIEW) return false;
		if (!renderedPreviewSnapshot) return false;

		if (effectiveVisibilityMode === "controlled") {
			return virtualizedVisibility === "visible";
		}

		return true;
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

	function canKeepRenderedPreviewForNextSnapshot(
		nextSnapshot: RenderedPreviewSnapshot | undefined,
	): boolean {
		if (!renderedPreviewSnapshot || !nextSnapshot) {
			return false;
		}

		return (
			renderedPreviewSnapshot.file.path === nextSnapshot.file.path &&
			renderedPreviewSnapshot.file.extension === nextSnapshot.file.extension
		);
	}

	function commitRenderedPreviewSnapshot(snapshot: RenderedPreviewSnapshot): void {
		renderedPreviewSnapshot = snapshot;
		activatedPreviewIdentity = snapshot.identity;
		visiblePreviewIdentity = snapshot.identity;

		if (
			effectiveVisibilityMode !== "controlled" &&
			previewCacheKey &&
			intersectedCache
		) {
			intersectedCache.add(previewCacheKey);
		}
	}

	function resetPreviewActivationForSnapshot(
		nextSnapshot: RenderedPreviewSnapshot | undefined,
	): void {
		const nextIdentity = nextSnapshot?.identity;

		if (nextIdentity === lastPreviewIdentity) {
			return;
		}

		cancelPendingActivation();

		// ファイル自体が変わった場合は、旧previewを見せ続けると誤表示になるので消す。
		if (!canKeepRenderedPreviewForNextSnapshot(nextSnapshot)) {
			renderedPreviewSnapshot = undefined;
			visiblePreviewIdentity = undefined;
			activatedPreviewIdentity = undefined;
		}

		// 同じファイルなら renderedPreviewSnapshot は残す。
		lastPreviewIdentity = nextIdentity;
	}

	function clearRegisteredRowActivationCandidate(): void {
		unregisterRowActivationCandidate?.();
		unregisterRowActivationCandidate = undefined;
		registeredRowActivationCandidateId = undefined;
		registeredRowActivationCandidateSignature = undefined;
	}

	function registerVisibleRowActivationCandidate(): void {
		if (effectiveVisibilityMode !== "controlled") {
			clearRegisteredRowActivationCandidate();
			return;
		}
		if (
			!rowPreviewActivationRuntime ||
			rowIndex === undefined ||
			!previewIdentity
		) {
			clearRegisteredRowActivationCandidate();
			return;
		}

		const candidateId = activationCandidateId ?? fallbackCandidateId;
		const signature = `${candidateId}\0${rowIndex}\0${previewIdentity}`;

		if (registeredRowActivationCandidateSignature === signature) {
			return;
		}

		clearRegisteredRowActivationCandidate();

		registeredRowActivationCandidateId = candidateId;
		registeredRowActivationCandidateSignature = signature;
		unregisterRowActivationCandidate =
			rowPreviewActivationRuntime.registerCandidate({
				id: candidateId,
				rowIndex,
				activationKey: previewIdentity,
				getVisibleQueueSize: getVisiblePreviewQueueSize,
				onActivated: (activationKey) => {
					const snapshot = currentPreviewSnapshot;

					if (
						!snapshot ||
						activationKey !== snapshot.identity ||
						virtualizedVisibility !== "visible"
					) {
						return;
					}

					commitRenderedPreviewSnapshot(snapshot);
				},
			});
	}

	function activateVisibleVirtualPreview(): void {
		if (
			effectiveVisibilityMode === "controlled" &&
			rowPreviewActivationRuntime &&
			rowIndex !== undefined
		) {
			cancelPendingActivation();
			return;
		}

		if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
			cancelPendingActivation();
			return;
		}

		const snapshot = currentPreviewSnapshot;

		if (virtualizedVisibility !== "visible" || !snapshot) {
			if (pendingPreviewIdentity) {
				cancelPendingActivation();
			}
			return;
		}

		if (activatedPreviewIdentity === snapshot.identity) {
			return;
		}

		if (pendingPreviewIdentity === snapshot.identity) {
			return;
		}

		const identity = snapshot.identity;

		cancelPendingActivation();

		const sequence = ++activationSequence;
		let request: PreviewActivationHandle | null = null;
		let synchronousResult: boolean | undefined;

		const onSettled = (activated: boolean): void => {
			if (!request) {
				synchronousResult = activated;
				return;
			}

			if (activationRequest === request) {
				activationRequest = null;
				pendingPreviewIdentity = undefined;
			}

			if (!activated) return;
			if (activationSequence !== sequence) return;
			if (currentPreviewSnapshot?.identity !== identity) return;
			if (virtualizedVisibility !== "visible") return;

			commitRenderedPreviewSnapshot(currentPreviewSnapshot);
		};

		const requestActivation =
			effectiveVisibilityMode === "controlled"
				? requestQueuedPreviewActivation
				: requestPreviewActivation;

		request = requestActivation(
			identity,
			getVisiblePreviewQueueSize,
			previewActivationScope,
			onSettled,
		);

		activationRequest = request;
		pendingPreviewIdentity = identity;

		if (synchronousResult !== undefined) {
			onSettled(synchronousResult);
		}
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
		resetPreviewActivationForSnapshot(currentPreviewSnapshot);
	});

	$effect(() => {
		registerVisibleRowActivationCandidate();
	});

	$effect(() => {
		activateVisibleVirtualPreview();
	});

	onDestroy(() => {
		clearRegisteredRowActivationCandidate();
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
			{#if shouldRenderPreview && renderedPreviewSnapshot}
				<CardPreview
					file={renderedPreviewSnapshot.file}
					getPreview={context.getPreview}
					searchQuery={renderedPreviewSnapshot.searchQuery}
					previewRefreshToken={renderedPreviewSnapshot.previewRefreshToken}
					previewOverride={renderedPreviewSnapshot.previewOverride}
				/>
			{:else}
				<div class="lazy-placeholder"></div>
			{/if}
		</div>
	{:else if shouldRenderPreview && renderedPreviewSnapshot}
		<CardPreview
			file={renderedPreviewSnapshot.file}
			getPreview={context.getPreview}
			searchQuery={renderedPreviewSnapshot.searchQuery}
			previewRefreshToken={renderedPreviewSnapshot.previewRefreshToken}
			previewOverride={renderedPreviewSnapshot.previewOverride}
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
		background-image:
			linear-gradient(var(--bar-color), var(--bar-color)),
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
