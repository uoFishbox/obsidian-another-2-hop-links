<script lang="ts">
	type ViewItem = {
		path: string;
	};

	interface Props {
		items?: ViewItem[];
		autofocus?: boolean;
	}

	let { items = [], autofocus }: Props = $props();

	let currentItems = $state<ViewItem[]>(items);

	$effect(() => {
		currentItems = items;
	});

	export function updateItems(nextItems: ViewItem[]): void {
		currentItems = nextItems;
	}
</script>

<div
	data-testid="tag-notes-list-host"
	data-autofocus={String(autofocus)}
	data-item-count={String(currentItems.length)}
></div>
