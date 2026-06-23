<script lang="ts" generics="T">
	import { type Snippet } from "svelte";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtualizedItemVisibility";

	type MountedItemCell = {
		cell: {
			kind: "item";
			item: T;
			itemIndex: number;
		};
	};

	interface Props<T> {
		items?: readonly T[];
		item?: Snippet<
			[
				{
					item: T;
					index: number;
					observerRoot: HTMLElement | null;
					visibility: VirtualizedItemVisibility;
				},
			]
		>;
		onMountedCellsChange?: (cells: readonly MountedItemCell[]) => void;
	}

	let { items = [], item, onMountedCellsChange }: Props<T> = $props();

	$effect(() => {
		onMountedCellsChange?.(
			items.map((entry, index) => ({
				cell: {
					kind: "item",
					item: entry,
					itemIndex: index,
				},
			})),
		);
	});
</script>

<div data-testid="filtered-count">{items.length}</div>

{#each items as entry, index}
	{@render item?.({
		item: entry,
		index,
		observerRoot: null,
		visibility: "visible",
	})}
{/each}
