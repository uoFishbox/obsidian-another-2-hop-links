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
		registerPreviewActivationBackpressure,
		requestQueuedPreviewActivation,
		type PreviewActivationHandle,
	} from "features/preview/scheduling/previewActivationScheduler";
	import { buildCardPreviewActivationIdentity } from "features/preview/core/cardPreviewActivationIdentity";
	import { normalizePreviewQuery } from "features/preview/core/previewRenderKeys";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW, IS_PROD } from "../../../appConstants";
	import {
		PREVIEW_VISIBILITY_CONTEXT_KEY,
		type PreviewVisibilityContext,
	} from "./previewVisibilityContext";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

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
		getActiveVisiblePreviewCount?: () => number;
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
		getActiveVisiblePreviewCount: providedGetActiveVisiblePreviewCount,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		previewRefreshToken = 0,
		contentPreview = undefined,
		rowIndex = undefined,
		activationCandidateId = undefined,
	}: Props = $props();

	const getVisiblePreviewQueueSize = providedGetVisiblePreviewQueueSize ?? (() => 0);
	const getActiveVisiblePreviewCount =
		providedGetActiveVisiblePreviewCount ?? (() => 0);
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
	const effectiveSearchQuery = $derived(
		searchScope === "title-only" ? "" : searchQuery,
	);
	const normalizedSearchQuery = $derived(normalizePreviewQuery(effectiveSearchQuery));
	const previewIdentity = $derived(
		file
			? buildCardPreviewActivationIdentity(
					file,
					settings,
					normalizedSearchQuery,
					previewRenderVersion,
					previewRefreshToken,
					previewOverride,
				)
			: undefined,
	);
	let activatedPreviewIdentity = $state<string | undefined>(undefined);
	let lastPreviewIdentity: string | undefined = undefined;
	let pendingPreviewIdentity: string | undefined = undefined;
	let activationRequest: PreviewActivationHandle | null = null;
	let activationSequence = 0;
	let unregisterRowActivationCandidate: (() => void) | undefined = undefined;
	let registeredRowActivationCandidateId: string | undefined = undefined;
	let registeredRowActivationCandidateRowIndex: number | undefined = undefined;
	let registeredRowActivationCandidatePreviewIdentity: string | undefined = undefined;
	const fallbackCandidateId = `card-preview-gate:${++nextCardPreviewGateId}`;

	let renderedPreviewSnapshot = $state.raw<RenderedPreviewSnapshot | undefined>(
		undefined,
	);

	const shouldRenderPreview = $derived.by(() => {
		if (DEBUG_DISABLE_CARD_DOM_PREVIEW) return false;
		if (!renderedPreviewSnapshot) return false;
		if (virtualizedVisibility !== "visible") return false;

		return canKeepRenderedPreviewForCurrentPreview();
	});
	const componentReevaluationProbe = $derived.by(() => {
		if (IS_PROD) return "";

		void file;
		void getPreview;
		void providedGetVisiblePreviewQueueSize;
		void providedGetActiveVisiblePreviewCount;
		void applicationStore;
		void searchQuery;
		void searchScope;
		void previewRefreshToken;
		void contentPreview;
		void rowIndex;
		void activationCandidateId;
		void visibility;
		void previewOverride;
		void settings;
		void previewRenderVersion;
		void virtualizedVisibility;
		void effectiveSearchQuery;
		void normalizedSearchQuery;
		void previewIdentity;
		void activatedPreviewIdentity;
		void renderedPreviewSnapshot;
		void shouldRenderPreview;
		return markCCLComponentReevaluation("CardPreviewGate");
	});

	function cancelPendingActivation(): void {
		activationSequence += 1;
		activationRequest?.cancel();
		activationRequest = null;
		pendingPreviewIdentity = undefined;
	}

	function canKeepRenderedPreviewForCurrentPreview(): boolean {
		if (!renderedPreviewSnapshot || !file || !previewIdentity) {
			return false;
		}

		return (
			renderedPreviewSnapshot.file.path === file.path &&
			renderedPreviewSnapshot.file.extension === file.extension
		);
	}

	function createRenderedPreviewSnapshot(
		identity: string,
		snapshotFile: TFile,
	): RenderedPreviewSnapshot {
		return {
			identity,
			file: snapshotFile,
			searchQuery: effectiveSearchQuery,
			previewRefreshToken,
			previewOverride,
		};
	}

	function commitRenderedPreviewSnapshot(snapshot: RenderedPreviewSnapshot): void {
		renderedPreviewSnapshot = snapshot;
		activatedPreviewIdentity = snapshot.identity;
	}

	function resetPreviewActivationForCurrentPreview(): void {
		const nextIdentity = previewIdentity;

		if (nextIdentity === lastPreviewIdentity) {
			return;
		}

		cancelPendingActivation();

		// ファイル自体が変わった場合は、旧previewを見せ続けると誤表示になるので消す。
		if (!canKeepRenderedPreviewForCurrentPreview()) {
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
		registeredRowActivationCandidateRowIndex = undefined;
		registeredRowActivationCandidatePreviewIdentity = undefined;
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

		if (
			registeredRowActivationCandidateId === candidateId &&
			registeredRowActivationCandidateRowIndex === rowIndex &&
			registeredRowActivationCandidatePreviewIdentity === previewIdentity
		) {
			return;
		}

		clearRegisteredRowActivationCandidate();

		registeredRowActivationCandidateId = candidateId;
		registeredRowActivationCandidateRowIndex = rowIndex;
		registeredRowActivationCandidatePreviewIdentity = previewIdentity;
		unregisterRowActivationCandidate =
			rowPreviewActivationRuntime.registerCandidate({
				id: candidateId,
				rowIndex,
				activationKey: previewIdentity,
				onActivated: (activationKey) => {
					if (
						!file ||
						activationKey !== previewIdentity ||
						virtualizedVisibility !== "visible"
					) {
						return;
					}

					commitRenderedPreviewSnapshot(
						createRenderedPreviewSnapshot(activationKey, file),
					);
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

		if (virtualizedVisibility !== "visible" || !file || !previewIdentity) {
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
			if (!file || previewIdentity !== identity) return;
			if (virtualizedVisibility !== "visible") return;

			commitRenderedPreviewSnapshot(
				createRenderedPreviewSnapshot(identity, file),
			);
		};

		request = requestQueuedPreviewActivation(
			identity,
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
		resetPreviewActivationForCurrentPreview();
	});

	$effect(() => {
		registerVisibleRowActivationCandidate();
	});

	$effect(() => {
		if (!previewActivationScope || !providedGetVisiblePreviewQueueSize) {
			return;
		}

		return registerPreviewActivationBackpressure(previewActivationScope, {
			getQueuedPreviewJobs: getVisiblePreviewQueueSize,
			getActivePreviewJobs: getActiveVisiblePreviewCount,
		});
	});

	$effect(() => {
		activateVisibleVirtualPreview();
	});

	onDestroy(() => {
		clearRegisteredRowActivationCandidate();
		cancelPendingActivation();
	});
</script>

{componentReevaluationProbe}
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
