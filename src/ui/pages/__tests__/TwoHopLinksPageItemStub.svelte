<script lang="ts">
	interface Props {
		item: {
			type: string;
			data: {
				path?: string;
				sourceFile?: {
					path?: string;
					basename?: string;
				};
				file?: {
					path?: string;
					basename?: string;
				};
				hop1?: {
					path?: string;
					rawText?: string;
				};
				rawText?: string;
			};
		};
		searchQuery?: string;
		settings?: unknown;
	}

	let { item, searchQuery = "", settings }: Props = $props();
	void settings;
	void searchQuery;
	const getItemKey = (currentItem: Props["item"]): string => {
		switch (currentItem.type) {
			case "branch":
				return `branch:${currentItem.data.hop1?.path ?? currentItem.data.hop1?.rawText ?? ""}`;
			case "backlink":
				return `backlink:${currentItem.data.sourceFile?.path ?? ""}:${currentItem.data.rawText ?? ""}`;
			case "newLink":
				return `new:${currentItem.data.path ?? ""}:${currentItem.data.rawText ?? ""}`;
			case "taggedNote":
				return `tag:${currentItem.data.file?.path ?? ""}`;
			default:
				return `${currentItem.type}:${currentItem.data.path ?? ""}`;
		}
	};
	const itemKey = $derived(getItemKey(item));

	const label =
		item.type === "backlink"
			? (item.data.sourceFile?.basename ?? "backlink")
			: item.type === "taggedNote"
				? (item.data.file?.basename ?? "taggedNote")
				: item.type === "newLink"
					? (item.data.rawText ?? "newLink")
					: (item.data.hop1?.rawText ?? item.type);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="cosense-card-links__box"
	data-testid="root-link-item"
	data-key={itemKey}
	data-type={item.type}
	data-search-query={searchQuery}
	data-ccl-interaction-id={itemKey}
	tabindex="0"
>
	{label}
</div>
