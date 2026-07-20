import type { PluginSettings } from "features/settings/model";
import type { ViewItem } from "application/presenters";
import type { CardPresentationState } from "ui/components/common/cardPresentation";
import type { CardRenderModel } from "./cardRenderModel";
import type { CardPreviewSlotState } from "features/preview/ui/cardPreviewSnapshot";

export interface ItemProps {
	item: ViewItem | undefined;
	settings: PluginSettings;
	searchQuery?: string;
	searchScope?: "title-only" | "title-and-content";
	draggable?: boolean;
	previewRefreshToken?: number;
	contentPreview?: string;
	interactionId?: string;
	interactionKey?: string;
	previewState?: CardPreviewSlotState;
	presentation?: CardPresentationState;
	model?: CardRenderModel;
}
