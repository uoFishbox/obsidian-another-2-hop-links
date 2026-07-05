<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import type { TFile } from "obsidian";
	import type { PreviewData, PreviewRequestOptions } from "ui/context/linkContext";
	import CardPreview from "ui/components/common/CardPreview.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import {
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
		type RowPreviewActivationRuntime,
	} from "features/preview/scheduling/rowPreviewActivationRuntime";
	import { buildCardPreviewActivationIdentity } from "features/preview/core/cardPreviewActivationIdentity";
	import { normalizePreviewQuery } from "features/preview/core/previewRenderKeys";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW, IS_PROD } from "../../../appConstants";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

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
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: "title-only" | "title-and-content";
		previewRefreshToken?: number;
		contentPreview?: string;
		rowIndex: number;
		activationCandidateId: string;
	}

	let {
		file,
		getPreview,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		previewRefreshToken = 0,
		contentPreview = undefined,
		rowIndex,
		activationCandidateId,
	}: Props = $props();

	const rowPreviewActivationRuntime = getContext<RowPreviewActivationRuntime>(
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	);
	const previewOverride: PreviewData | null = $derived(
		file && file.extension !== "md" && contentPreview
			? ({ type: "text", content: contentPreview } as const)
			: null,
	);
	const settings = $derived(applicationStore.settings);
	const previewRenderVersion = $derived(
		file ? (applicationStore.getPreviewRenderVersion?.(file.path) ?? "0:0") : "0:0",
	);
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
	let unregisterRowActivationCandidate: (() => void) | undefined = undefined;
	let registeredRowActivationCandidateId: string | undefined = undefined;
	let registeredRowActivationCandidateRowIndex: number | undefined = undefined;
	let registeredRowActivationCandidatePreviewIdentity: string | undefined = undefined;

	let renderedPreviewSnapshot = $state.raw<RenderedPreviewSnapshot | undefined>(
		undefined,
	);
	const componentReevaluationProbe = $derived.by(() => {
		if (IS_PROD) return "";

		void file;
		void getPreview;
		void applicationStore;
		void searchQuery;
		void searchScope;
		void previewRefreshToken;
		void contentPreview;
		void rowIndex;
		void activationCandidateId;
		void previewOverride;
		void settings;
		void previewRenderVersion;
		void effectiveSearchQuery;
		void normalizedSearchQuery;
		void previewIdentity;
		void activatedPreviewIdentity;
		void renderedPreviewSnapshot;
		return markCCLComponentReevaluation("CardPreviewGate");
	});

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
		if (!previewIdentity || activatedPreviewIdentity === previewIdentity) {
			clearRegisteredRowActivationCandidate();
			return;
		}

		if (
			registeredRowActivationCandidateId === activationCandidateId &&
			registeredRowActivationCandidateRowIndex === rowIndex &&
			registeredRowActivationCandidatePreviewIdentity === previewIdentity
		) {
			return;
		}

		clearRegisteredRowActivationCandidate();

		registeredRowActivationCandidateId = activationCandidateId;
		registeredRowActivationCandidateRowIndex = rowIndex;
		registeredRowActivationCandidatePreviewIdentity = previewIdentity;
		unregisterRowActivationCandidate =
			rowPreviewActivationRuntime.registerCandidate({
				id: activationCandidateId,
				rowIndex,
				activationKey: previewIdentity,
				onActivated: (activationKey) => {
					if (!file || activationKey !== previewIdentity) {
						return;
					}
					if (activatedPreviewIdentity === activationKey) {
						return;
					}

					commitRenderedPreviewSnapshot(
						createRenderedPreviewSnapshot(activationKey, file),
					);
				},
			});
	}

	$effect(() => {
		resetPreviewActivationForCurrentPreview();
	});

	$effect(() => {
		registerVisibleRowActivationCandidate();
	});

	onDestroy(() => {
		clearRegisteredRowActivationCandidate();
	});
</script>

{componentReevaluationProbe}
{#if !DEBUG_DISABLE_CARD_DOM_PREVIEW && file}
	{#if renderedPreviewSnapshot && canKeepRenderedPreviewForCurrentPreview()}
		<CardPreview
			file={renderedPreviewSnapshot.file}
			{getPreview}
			searchQuery={renderedPreviewSnapshot.searchQuery}
			previewRefreshToken={renderedPreviewSnapshot.previewRefreshToken}
			previewOverride={renderedPreviewSnapshot.previewOverride}
		/>
	{/if}
{/if}
