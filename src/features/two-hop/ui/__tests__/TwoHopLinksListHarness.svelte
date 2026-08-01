<script lang="ts">
	import TwoHopLinksList from "features/two-hop/ui/TwoHopLinksList.svelte";
	import { setLinkContext, type LinkContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		linkContext: LinkContext;
		previewDependencies: TwoHopPreviewDependencies;
	}

	let { sections, applicationStore, linkContext, previewDependencies }: Props =
		$props();
	setLinkContext(linkContext);
</script>

<TwoHopLinksList {sections} {applicationStore} {linkContext} {previewDependencies} />
