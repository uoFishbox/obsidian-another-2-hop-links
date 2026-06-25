import type { TFile } from "obsidian";
import type { TwoHopIndexedLink, TwoHopLinkBranch, TaggedNote } from "types";
import type { LinkUtilitiesContext } from "ui/context/linkContext";
import type { ViewItem } from "./ViewItem";

export type ViewItemData = TwoHopIndexedLink | TwoHopLinkBranch | TaggedNote | TFile;

export interface ItemStrategy {
	getFile(item: ViewItemData): TFile | undefined;
	getTargetFile(item: ViewItemData, context: LinkUtilitiesContext): TFile | null;
	getRawText(item: ViewItemData): string;
	getClassName(item: ViewItemData): string | null;
}

export const BacklinkStrategy: ItemStrategy = {
	getFile(item: TwoHopIndexedLink): TFile | undefined {
		return item.sourceFile;
	},

	getTargetFile(item: TwoHopIndexedLink): TFile | null {
		return item.sourceFile;
	},

	getRawText(item: TwoHopIndexedLink): string {
		return item.rawText;
	},

	getClassName(): string | null {
		return null;
	},
};

export const NewLinkStrategy: ItemStrategy = {
	getFile(): TFile | undefined {
		return undefined;
	},

	getTargetFile(): TFile | null {
		return null;
	},

	getRawText(item: TwoHopIndexedLink): string {
		return item.rawText;
	},

	getClassName(): string | null {
		return "cosense-card-links__box--missing";
	},
};

export const OutgoingStrategy: ItemStrategy = {
	getFile(): TFile | undefined {
		return undefined;
	},

	getTargetFile(item: TwoHopLinkBranch, context: LinkUtilitiesContext): TFile | null {
		if (item.hop1.path) {
			return context.resolveFile(item.hop1.path);
		}
		return null;
	},

	getRawText(item: TwoHopLinkBranch): string {
		return item.hop1.rawText;
	},

	getClassName(item: TwoHopLinkBranch): string | null {
		return item.hop1.isUnresolved
			? "cosense-card-links__box--missing"
			: "cosense-card-links__box--existing";
	},
};

export const NonMdStrategy: ItemStrategy = {
	getFile(item: TFile): TFile | undefined {
		return item;
	},

	getTargetFile(item: TFile): TFile | null {
		return item;
	},

	getRawText(item: TFile): string {
		return item.basename;
	},

	getClassName(): string | null {
		return null;
	},
};

export const TaggedNoteStrategy: ItemStrategy = {
	getFile(item: TaggedNote): TFile | undefined {
		return item.file;
	},

	getTargetFile(item: TaggedNote): TFile | null {
		return item.file;
	},

	getRawText(item: TaggedNote): string {
		return item.file.basename;
	},

	getClassName(): string | null {
		return null;
	},
};

export function getItemStrategy(item: ViewItem): ItemStrategy | null {
	switch (item.type) {
		case "newLink":
			return NewLinkStrategy;
		case "backlink":
			return BacklinkStrategy;
		case "branch":
			return OutgoingStrategy;
		case "taggedNote":
			return TaggedNoteStrategy;
		case "file":
			return NonMdStrategy;
		default:
			return null;
	}
}
