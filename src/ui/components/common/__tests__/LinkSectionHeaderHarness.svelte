<script lang="ts">
	import LinkSectionHeader from "../LinkSectionHeader.svelte";
	import type { CardSectionVariant } from "../cardPresentation";
	import { setAppContext } from "ui/context/linkContext";

	interface Props {
		sectionVariant: CardSectionVariant;
	}

	let { sectionVariant }: Props = $props();
	setAppContext({} as never);
</script>

<LinkSectionHeader title="Header" totalCount={1} {sectionVariant} />
