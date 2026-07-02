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
	import { normalizePreviewQuery } from "features/preview/core/previewRenderKeys";
	import { DEBUG_DISABLE_CARD_DOM_PREVIEW, IS_PROD } from "../../../appConstants";
	import {
		PREVIEW_VISIBILITY_CONTEXT_KEY,
		type PreviewVisibilityContext,
	} from "./previewVisibilityContext";
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
		getVisiblePreviewQueueSize?: () => number;
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: "title-only" | "title-and-content";
		previewRefreshToken?: number;
		contentPreview?: string;
		rowIndex?: number;
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
	let rowActivationVersion = $state<number | undefined>(undefined);
	let lastHandledRowActivationVersion: number | undefined = undefined;

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
		void applicationStore;
		void searchQuery;
		void searchScope;
		void previewRefreshToken;
		void contentPreview;
		void rowIndex;
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

	function subscribeRowActivationVersion(): (() => void) | undefined {
		if (!rowPreviewActivationRuntime || rowIndex === undefined) {
			rowActivationVersion = undefined;
			lastHandledRowActivationVersion = undefined;
			return;
		}

		lastHandledRowActivationVersion = undefined;
		return rowPreviewActivationRuntime
			.getRowActivationVersion(rowIndex)
			.subscribe((nextVersion) => {
				rowActivationVersion = nextVersion;
			});
	}

	function requestVisibleRowActivation(): boolean {
		if (!rowPreviewActivationRuntime || rowIndex === undefined) {
			return false;
		}

		cancelPendingActivation();

		if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
			return true;
		}

		if (virtualizedVisibility !== "visible" || !file || !previewIdentity) {
			return true;
		}

		if (activatedPreviewIdentity === previewIdentity) {
			return true;
		}

		rowPreviewActivationRuntime.requestRowActivation(rowIndex);
		return true;
	}

	function activateVisibleVirtualPreview(): void {
		if (requestVisibleRowActivation()) {
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

	function commitVisibleRowActivation(): void {
		if (
			!rowPreviewActivationRuntime ||
			rowIndex === undefined ||
			rowActivationVersion === undefined ||
			rowActivationVersion <= 0
		) {
			return;
		}

		if (lastHandledRowActivationVersion === rowActivationVersion) {
			return;
		}

		lastHandledRowActivationVersion = rowActivationVersion;
		if (
			DEBUG_DISABLE_CARD_DOM_PREVIEW ||
			virtualizedVisibility !== "visible" ||
			!file ||
			!previewIdentity
		) {
			return;
		}

		if (activatedPreviewIdentity === previewIdentity) {
			return;
		}

		commitRenderedPreviewSnapshot(
			createRenderedPreviewSnapshot(previewIdentity, file),
		);
	}

	$effect(() => {
		resetPreviewActivationForCurrentPreview();
	});

	$effect(() => {
		return subscribeRowActivationVersion();
	});

	$effect(() => {
		activateVisibleVirtualPreview();
	});

	$effect(() => {
		commitVisibleRowActivation();
	});

	onDestroy(() => {
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
