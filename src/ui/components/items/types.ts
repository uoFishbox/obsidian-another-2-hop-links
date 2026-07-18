import type { PluginSettings } from "types/settings";
import type { ViewItem } from "application/presenters";
import type { CardPresentationState } from "ui/components/common/cardPresentation";
import type { CardRenderModel } from "./cardRenderModel";

export interface ItemProps {
	item: ViewItem | undefined;
	settings: PluginSettings;
	searchQuery?: string;
	searchScope?: "title-only" | "title-and-content";
	draggable?: boolean;
	previewRefreshToken?: number;
	contentPreview?: string;
	interactionRegistration?: "self" | "snapshot";
	interactionId?: string;
	interactionKey?: string;
	rowIndex?: number;
	activationCandidateId?: string;
	presentation?: CardPresentationState;
	model?: CardRenderModel;
}
