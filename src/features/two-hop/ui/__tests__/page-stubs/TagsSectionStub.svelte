<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { TagGroup } from "types/domain";
	import { DEFAULT_SETTINGS } from "features/settings/model";

	interface Props {
		tagGroups: TagGroup[];
		searchQuery?: string;
	}

	let { tagGroups, searchQuery = "" }: Props = $props();
</script>

{#each tagGroups as section}
	{#each section.notes as note}
		<ViewItemCard
			item={{
				type: "taggedNote",
				data: note,
			}}
			settings={DEFAULT_SETTINGS}
			{searchQuery}
		/>
	{/each}
{/each}
