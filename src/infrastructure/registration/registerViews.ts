import type { PluginHostUi } from "types/pluginHostUi";
import {
	TwoHopLinksView,
	TWO_HOP_LINKS_VIEW_TYPE,
} from "features/two-hop/ui/TwoHopLinksView";
import {
	PreCreationView,
	VIEW_TYPE_PRE_CREATE,
} from "features/pre-creation/ui/PreCreationView";
import { TagNotesView, VIEW_TYPE_TAG_NOTES } from "features/tag-notes/ui/TagNotesView";
import {
	COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "features/preview/interactions/hoverPopoverLinkSpec";

export function registerViews(plugin: PluginHostUi): void {
	plugin.registerView(
		TWO_HOP_LINKS_VIEW_TYPE,
		(leaf) => new TwoHopLinksView(leaf, plugin),
	);
	plugin.registerView(
		VIEW_TYPE_PRE_CREATE,
		(leaf) => new PreCreationView(leaf, plugin),
	);
	plugin.registerView(VIEW_TYPE_TAG_NOTES, (leaf) => new TagNotesView(leaf, plugin));
	plugin.registerHoverLinkSource(COSENSE_CARD_LINKS_HOVER_SOURCE_ID, {
		display: COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
		defaultMod: true,
	});
}
