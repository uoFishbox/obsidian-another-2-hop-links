import type { PluginSettings } from "features/settings/model";
import type { ViewItem } from "application/presenters";
import type { CardRenderModel } from "./cardRenderModel";

export interface ItemProps {
	item: ViewItem | undefined;
	settings: PluginSettings;
	searchQuery?: string;
	searchScope?: "title-only" | "title-and-content";
	draggable?: boolean;
	contentPreview?: string;
	interactionId?: string;
	previewKey?: string;
	model?: CardRenderModel;
}
