import type { TFile } from "obsidian";
import type { TaggedNote, TwoHopLinkBranch } from "types/domain";
import type { PluginSettings, SortOption } from "types/settings";
import type { ViewItem } from "application/presenters";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";

// ---------------------------------------------------------------------------
// Primary link section
// ---------------------------------------------------------------------------

export interface PrimaryLinkSection {
	title: string;
	sectionId: string;
	className?: string;
	items: readonly ViewItem[];
	getKey: (item: ViewItem, index: number) => string;
	getSearchKey: (item: ViewItem) => string;
}

// ---------------------------------------------------------------------------
// Two-hop branch header snapshots
// ---------------------------------------------------------------------------

export interface TwoHopHeaderSnapshot {
	file: TFile | null;
	className: string;
	settings: PluginSettings;
	directory: string | null;
}

export interface TwoHopHeaderInteractionSnapshot {
	link: TwoHopLinkBranch["hop1"];
	targetFile: TFile | null;
	directory: string | null;
	settings: PluginSettings;
}

// ---------------------------------------------------------------------------
// Data identity dependency snapshots
// ---------------------------------------------------------------------------

export interface TwoHopItemsDeps {
	hop2: TwoHopLinkBranch["hop2"];
	sortOption: SortOption;
	updateVersion: number;
	getSortedTwoHopItems: ApplicationStore["getSortedTwoHopItems"];
}

export interface TagSectionItemsDeps {
	notes: TaggedNote[];
	sortOption: SortOption;
	updateVersion: number;
	getSortedTagGroupItems: ApplicationStore["getSortedTagGroupItems"];
}

export interface PrimarySectionItemsDeps {
	items: readonly ViewItem[];
	updateVersion: number;
}

export interface NewLinksSectionItemsDeps {
	items: readonly ViewItem[];
	updateVersion: number;
}
