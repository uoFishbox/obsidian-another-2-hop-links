import type { TFile } from "obsidian";

export const TWO_HOP_LINKS_VIEW_TYPE = "cosense-card-links-view";
export const VIEW_TYPE_PRE_CREATE = "cosense-card-links-pre-create-view";
export const VIEW_TYPE_TAG_NOTES = "cosense-card-links-tag-notes-view";
export const VIEW_TYPE_ALL_NOTES = "cosense-card-links-all-notes-view";

export interface TwoHopLinksViewApi {
	renderForFile(file: TFile): void;
	clearContent(): void;
}

export function isTwoHopLinksViewApi(view: unknown): view is TwoHopLinksViewApi {
	if (typeof view !== "object" || view === null) return false;
	const candidate = view as Partial<TwoHopLinksViewApi>;
	return (
		typeof candidate.renderForFile === "function" &&
		typeof candidate.clearContent === "function"
	);
}
