<script lang="ts">
	import { onDestroy } from "svelte";
	import VirtualInteractiveSurface from "ui/components/common/virtual-list/svelte/VirtualInteractiveSurface.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
	import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
	import { createResolvedCardLayoutSettingsMemo } from "ui/utils/cardLayoutCssVars";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { LinkUtilitiesContext } from "types/linkContext";
	import { useAppContext } from "ui/context/linkContext";
	import type { TwoHopCardPresentationState } from "./twoHopCellStaticState";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "./twoHopVirtualListModel";
	import {
		createTwoHopViewportController,
		type TwoHopViewportController,
	} from "./twoHopViewportController";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore?: ApplicationStore;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		getItemInteractionDescriptor: (
			item: TwoHopVirtualListItem,
		) => ItemInteractionDescriptor | null;
		interactionDescriptorRevision?: unknown;
		cardModelRevision?: unknown;
		shellTitleRevision?: unknown;
		resolveItemCardModel?: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
		resolveItemTitle?: (item: TwoHopVirtualListItem) => string;
		linkContext?: LinkUtilitiesContext;
		previewActive?: boolean;
	}

	const props: Props = $props();
	const previewAppContext = (() => {
		try {
			return useAppContext();
		} catch {
			return undefined;
		}
	})();
	let rootEl = $state<HTMLDivElement | null>(null);
	let contentEl = $state<HTMLDivElement | null>(null);
	let interactionShadowRoot = $state<ShadowRoot | null>(null);
	let observerRoot = $state<HTMLElement | null>(null);
	let controller: TwoHopViewportController | null = null;
	const resolveConfiguredLayout = createResolvedCardLayoutSettingsMemo();
	const configuredLayout = $derived(
		resolveConfiguredLayout(props.applicationStore?.settings),
	);
	const interactionDescriptorResolverProvider: InteractionDescriptorResolverProvider =
		{
			resolveInteractionDescriptor(interactionId) {
				return controller?.resolveInteractionDescriptor(interactionId) ?? null;
			},
		};
	const resolveNavigationTarget = (
		...args: Parameters<TwoHopViewportController["resolveNavigationTarget"]>
	) => controller?.resolveNavigationTarget(...args) ?? null;
	const flushVirtualScrollMeasurement = () => controller?.flush();

	$effect(() => {
		const element = rootEl;
		if (!element || controller) return;

		controller = createTwoHopViewportController({
			rootEl: element,
			shadowHostEl: element,
			sections: props.sections,
			revision: props.cardModelRevision,
			shellTitleRevision: props.shellTitleRevision,
			applicationStore: props.applicationStore,
			initialVisibleCount: props.initialVisibleCount,
			loadMoreIncrement: props.loadMoreIncrement,
			configuredLayout,
			resolveItemCardModel: (item, presentation) =>
				props.resolveItemCardModel?.(item, presentation) ??
				({
					item: item.item,
					targetFile: null,
					title: item.virtualKey,
					ariaLabel: item.virtualKey,
					className: null,
					extension: presentation.extension,
					directory: null,
					interactionId: item.interactionId ?? item.virtualKey,
					interactionKey: item.interactionKey ?? item.virtualKey,
					presentation,
					searchQuery: "",
					searchScope: "title-only",
					contentPreview: undefined,
					previewRefreshToken: 0,
					previewActivationIdentity: undefined,
				} satisfies CardRenderModel),
			resolveItemTitle: (item) =>
				props.resolveItemTitle?.(item) ?? item.virtualKey,
			getItemInteractionDescriptor: (item) =>
				props.getItemInteractionDescriptor(item),
			getPreview: props.linkContext?.getPreview,
			previewApp: previewAppContext?.app,
			previewSourcePath: props.linkContext?.sourceFile.path,
		});
		contentEl = controller.contentEl;
		interactionShadowRoot = controller.shadowRoot;
		observerRoot = controller.scrollContainerEl;
	});

	$effect(() => {
		void props.interactionDescriptorRevision;
		controller?.setSections(
			props.sections,
			props.cardModelRevision,
			props.shellTitleRevision,
		);
	});

	$effect(() => {
		controller?.setConfiguredLayout(configuredLayout);
	});

	$effect(() => {
		controller?.setPreviewActive(props.previewActive ?? true);
	});

	onDestroy(() => controller?.dispose());
</script>

<VirtualInteractiveSurface
	className="cosense-card-links__section view-plan-virtual-list twohop-page-virtual-list twohop-imperative-surface"
	rowHeight={configuredLayout?.cardHeightPx ?? 1}
	interactionDescriptorScopeId="twohop-imperative-cells"
	{interactionDescriptorResolverProvider}
	bind:rootEl
	bind:contentEl
	bind:interactionShadowRoot
	{observerRoot}
	{resolveNavigationTarget}
	{flushVirtualScrollMeasurement}
/>
