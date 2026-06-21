import type { PluginSettings } from "types/settings";
import type { ViewItem } from "application/presenters";

export type PreviewVisibilityMode = "self-observed" | "controlled";

export interface ItemProps {
	item: ViewItem | undefined;
	settings: PluginSettings;
	searchQuery?: string;
	searchScope?: "title-only" | "title-and-content";
	observerRoot?: HTMLElement | null;
	previewVisibilityMode?: PreviewVisibilityMode;
	draggable?: boolean;
	previewRefreshToken?: number;
	contentPreview?: string;
	interactionRegistration?: "self" | "snapshot";
	interactionId?: string;
	interactionKey?: string;
}
