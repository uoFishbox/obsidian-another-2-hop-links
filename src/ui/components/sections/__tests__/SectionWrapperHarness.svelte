<script lang="ts">
	import { setContext } from "svelte";
	import SectionWrapper from "../SectionWrapper.svelte";
	import { setAppContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

	interface Props {
		items: string[];
		applicationStore: ApplicationStore;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		getKey?: (item: string, index: number) => string;
	}

	let {
		items,
		applicationStore,
		initialVisibleCount = 3,
		loadMoreIncrement = 3,
		getKey = (item, index) => `${item}-${index}`,
	}: Props = $props();

	setContext<ApplicationStore>("applicationStore", applicationStore);
	setAppContext({
		linkContext: {} as any,
		applicationStore,
		app: {} as any,
		bookmarks: {
			filePaths: new Set<string>(),
			orderedFilePaths: [],
			isBookmarked: () => false,
		},
	});
</script>

<div
	class="scroll-root"
	data-testid="scroll-root"
	style="overflow: auto; position: relative;"
>
	<div
		class="section-host"
		data-testid="section-host"
		style="position: relative; width: 330px; --ccl-box-size: 100px; --ccl-box-height: 120px; --ccl-box-gap: 10px; --ccl-box-cols-max: 4;"
	>
		<SectionWrapper
			title="Links"
			{items}
			sectionId="section-under-test"
			getKey={(item, index) => getKey(item as string, index)}
			{initialVisibleCount}
			{loadMoreIncrement}
		>
			{#snippet itemRenderer({ item, index })}
				<div class="test-cell" data-testid="item-cell" data-index={index}>
					{item as string}
				</div>
			{/snippet}
		</SectionWrapper>
	</div>
</div>

<style>
	.test-cell {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.04);
	}
</style>
