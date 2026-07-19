<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { TwoHopLinkBranch } from "types/domain";
	import { DEFAULT_SETTINGS } from "features/settings/model";

	interface Props {
		branches: TwoHopLinkBranch[];
		searchQuery?: string;
	}

	let { branches, searchQuery = "" }: Props = $props();
</script>

{#each branches as branch}
	{#each branch.hop2 as link}
		<ViewItemCard
			item={{
				type: "backlink",
				data: link,
			}}
			settings={DEFAULT_SETTINGS}
			{searchQuery}
		/>
	{/each}
{/each}
