import type { PaneType, ViewState } from "obsidian";
import { normalizeTag } from "indexing/tag-index/tagIndexer";
import type { PluginHost } from "obsidian-integration/pluginHost";
import { VIEW_TYPE_TAG_NOTES } from "obsidian-integration/views/viewTypes";

/** Opens the tag-notes view without loading its Svelte implementation. */
export async function openTagNotesView(
	plugin: PluginHost,
	tag: string,
	sourcePath: string,
	newLeaf: PaneType | boolean = false,
): Promise<void> {
	if (!plugin.settings.enableTagFeatures) return;

	const normalizedTag = normalizeTag(tag);
	if (!normalizedTag) return;

	const leaf = plugin.app.workspace.getLeaf(newLeaf);
	const viewState: ViewState = {
		type: VIEW_TYPE_TAG_NOTES,
		state: { tag: normalizedTag, sourcePath },
		active: true,
	};

	await leaf.setViewState(viewState);
	plugin.app.workspace.revealLeaf(leaf);
}
