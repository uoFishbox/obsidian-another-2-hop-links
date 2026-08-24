import type { IIndexingService } from "types";
import type { LinkContext } from "ui/context/linkContext";
import type { PluginHost } from "types/pluginHost";
import { areTagFeaturesEnabled } from "features/settings/model";
import { openTagNotesView } from "./TagNotesView";

export async function handleTagClick(
	tag: string,
	linkContext: LinkContext,
	indexingService: IIndexingService,
	plugin: PluginHost,
): Promise<void> {
	if (!areTagFeaturesEnabled(plugin.settings)) {
		return;
	}

	const notes = await indexingService.getNotesWithTag(
		tag,
		linkContext.sourceFile.path,
	);
	if (notes.length === 0) {
		return;
	}

	void openTagNotesView(plugin, tag, linkContext.sourceFile.path, false);
}
