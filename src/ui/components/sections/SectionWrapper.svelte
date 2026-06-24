<script lang="ts" generics="T">
	import type { Snippet } from "svelte";
	import LinkSectionHeader from "../common/LinkSectionHeader.svelte";
	import LinkList from "../common/VirtualGridLinkList.svelte";
	import { buildScopedSectionId } from "../common/listPagination";
	import { getContext } from "svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type {
		VirtualizedItemVisibility,
		VirtualizedItemVisibilityState,
	} from "ui/components/common/virtualizedItemVisibility";

	interface Props<T> {
		title: string;
		items: readonly T[];
		sectionId: string;
		className?: string;
		getKey: (item: T, index: number) => string;
		sectionIdScope?: string;
		initialVisibleCount: number | undefined;
		loadMoreIncrement?: number;
		headerIcon?: Snippet;
		itemRenderer: Snippet<
			[
				{
					item: T;
					index: number;
					rowIndex: number;
					observerRoot: HTMLElement | null;
					visibility: VirtualizedItemVisibility;
					visibilityState: VirtualizedItemVisibilityState;
				},
			]
		>;
	}

	let {
		title,
		items,
		sectionId,
		className = "",
		getKey,
		sectionIdScope = "",
		initialVisibleCount,
		loadMoreIncrement,
		headerIcon,
		itemRenderer,
	}: Props<T> = $props();

	const applicationStore = getContext<ApplicationStore>("applicationStore");
	const effectiveSectionId = $derived(
		buildScopedSectionId(sectionId, sectionIdScope),
	);
</script>

<div class="cosense-card-links__section {className}">
	{#key effectiveSectionId}
		<LinkList
			{items}
			{getKey}
			sectionId={effectiveSectionId}
			{applicationStore}
			{className}
			{initialVisibleCount}
			{loadMoreIncrement}
		>
			{#snippet header()}
				<LinkSectionHeader
					{title}
					totalCount={items.length}
					icon={headerIcon}
				/>
			{/snippet}

			{#snippet item(props)}
				{@render itemRenderer(props)}
			{/snippet}
		</LinkList>
	{/key}
</div>
