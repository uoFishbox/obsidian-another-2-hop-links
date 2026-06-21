import type { PluginHost } from "types/pluginHost";
import {
	TwoHopLinksView,
	TWO_HOP_LINKS_VIEW_TYPE,
} from "ui/views/TwoHopLinksView";
import {
	PreCreationView,
	VIEW_TYPE_PRE_CREATE,
} from "ui/views/PreCreationView";
import { TagNotesView, VIEW_TYPE_TAG_NOTES } from "ui/views/TagNotesView";
import { DeskView, VIEW_TYPE_DESK } from "ui/views/DeskView";
import {
	COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "features/preview/interactions/hoverPopoverLinkSpec";

/**
 * Registers all custom view types and the hover link source with the plugin.
 */
export function registerViews(plugin: PluginHost): void {
	plugin.registerView(
		TWO_HOP_LINKS_VIEW_TYPE,
		(leaf) => new TwoHopLinksView(leaf, plugin),
	);
	plugin.registerView(
		VIEW_TYPE_PRE_CREATE,
		(leaf) => new PreCreationView(leaf, plugin),
	);
	plugin.registerView(
		VIEW_TYPE_TAG_NOTES,
		(leaf) => new TagNotesView(leaf, plugin),
	);
	plugin.registerView(
		VIEW_TYPE_DESK,
		(leaf) => new DeskView(leaf, plugin),
	);
	plugin.registerHoverLinkSource(COSENSE_CARD_LINKS_HOVER_SOURCE_ID, {
		display: COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
		defaultMod: true,
	});
}
