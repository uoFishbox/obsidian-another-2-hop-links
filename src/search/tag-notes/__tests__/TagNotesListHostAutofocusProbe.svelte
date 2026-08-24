<script lang="ts">
	type CardItem = {
		path: string;
	};

	interface Props {
		items?: CardItem[];
		autofocus?: boolean;
	}

	let { items = [], autofocus }: Props = $props();

	let currentItems = $state<CardItem[]>(items);

	$effect(() => {
		currentItems = items;
	});

	export function updateItems(nextItems: CardItem[]): void {
		currentItems = nextItems;
	}
</script>

<div
	data-testid="tag-notes-list-host"
	data-autofocus={String(autofocus)}
	data-item-count={String(currentItems.length)}
></div>
