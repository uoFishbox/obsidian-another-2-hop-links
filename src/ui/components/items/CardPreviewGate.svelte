<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import type { TFile } from "obsidian";
	import type { PreviewData, PreviewRequestOptions } from "ui/context/linkContext";
	import CardPreview from "ui/components/common/CardPreview.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import {
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
		type PreviewActivationScope,
	} from "features/preview/scheduling/previewActivationScope";
	import {
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
		type RowPreviewActivationRuntime,
	} from "features/preview/scheduling/rowPreviewActivationRuntime";
	import {
		requestQueuedPreviewActivation,
		type PreviewActivationHandle,
	} from "features/preview/scheduling/previewActivationScheduler";
	import { buildCardPreviewActivationIdentity } from "features/preview/core/cardPreviewActivationIdentity";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
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
		getPreview: (
			file: TFile,
			signal?: AbortSignal,
			options?: PreviewRequestOptions,
		) => Promise<PreviewData>;
		getVisiblePreviewQueueSize?: () => number;
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: "title-only" | "title-and-content";
		previewRefreshToken?: number;
		contentPreview?: string;
		rowIndex?: number;
		activationCandidateId?: string;
	}

	let {
		file,
		getPreview,
		getVisiblePreviewQueueSize: providedGetVisiblePreviewQueueSize,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		previewRefreshToken = 0,
		contentPreview = undefined,
		rowIndex = undefined,
		activationCandidateId = undefined,
	}: Props = $props();

	const getVisiblePreviewQueueSize = providedGetVisiblePreviewQueueSize ?? (() => 0);
	const previewVisibilityContext = getContext<PreviewVisibilityContext | undefined>(
		PREVIEW_VISIBILITY_CONTEXT_KEY,
	);
	const previewActivationScope = getContext<PreviewActivationScope | undefined>(
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
	);
	const rowPreviewActivationRuntime = getContext<
		RowPreviewActivationRuntime | undefined
	>(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY);
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
	const virtualizedVisibility = $derived(visibility);
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
		return virtualizedVisibility === "visible";
	});

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
		if (rowPreviewActivationRuntime && rowIndex !== undefined) {
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

		request = requestQueuedPreviewActivation(
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

{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW && file}
	{#if shouldRenderPreview && renderedPreviewSnapshot}
		<CardPreview
			file={renderedPreviewSnapshot.file}
			{getPreview}
			searchQuery={renderedPreviewSnapshot.searchQuery}
			previewRefreshToken={renderedPreviewSnapshot.previewRefreshToken}
			previewOverride={renderedPreviewSnapshot.previewOverride}
		/>
	{/if}
{/if}
