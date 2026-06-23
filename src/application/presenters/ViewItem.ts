import { TFile } from "obsidian";
import type { SortableItem } from "core/sorting";
import type { TwoHopIndexedLink, TwoHopLinkBranch, TaggedNote } from "types/domain";

export type ViewItem =
	| {
			type: "branch";
			data: TwoHopLinkBranch;
	  }
	| {
			type: "newLink";
			data: TwoHopIndexedLink;
	  }
	| {
			type: "backlink";
			data: TwoHopIndexedLink;
	  }
	| {
			type: "taggedNote";
			data: TaggedNote;
	  }
	| {
			type: "file";
			data: TFile;
	  };

const isTwoHopLinkBranch = (item: SortableItem): item is TwoHopLinkBranch =>
	"hop1" in item && "hop2" in item;

const isTwoHopIndexedLink = (item: SortableItem): item is TwoHopIndexedLink =>
	"sourceFile" in item && "rawText" in item && !("hop1" in item);

const isTaggedNote = (item: SortableItem): item is TaggedNote =>
	"file" in item && "commonTags" in item;

export function toViewItem(item: SortableItem): ViewItem {
	if (isTwoHopLinkBranch(item)) {
		return { type: "branch", data: item };
	}

	if (isTwoHopIndexedLink(item)) {
		return { type: "backlink", data: item };
	}

	if (isTaggedNote(item)) {
		return { type: "taggedNote", data: item };
	}

	if (item instanceof TFile) {
		return { type: "file", data: item };
	}

	throw new Error("Unsupported sortable item");
}

export function toViewItems(items: SortableItem[]): ViewItem[] {
	const viewItems = new Array<ViewItem>(items.length);
	for (let index = 0; index < items.length; index += 1) {
		viewItems[index] = toViewItem(items[index]);
	}
	return viewItems;
}

export function fromViewItem(item: ViewItem): SortableItem {
	return item.data;
}

export function getViewItemKey(item: ViewItem): string {
	switch (item.type) {
		case "taggedNote":
			return item.data.path;
		case "file":
			return item.data.path;
		case "backlink":
			return item.data.sourceFile.path;
		case "newLink":
			return (
				item.data.lookupPath ??
				item.data.path ??
				`${item.data.sourceFile.path}:${item.data.rawText}`
			);
		case "branch":
			return (
				item.data.hop1.lookupPath ??
				item.data.hop1.path ??
				item.data.hop1.rawText
			);
		default:
			return "";
	}
}

export function getViewItemPath(item: ViewItem): string | null {
	switch (item.type) {
		case "taggedNote":
			return item.data.path;
		case "file":
			return item.data.path;
		case "backlink":
			return item.data.sourceFile.path;
		case "newLink":
			return item.data.path ?? null;
		case "branch":
			return item.data.hop1.path ?? null;
		default:
			return null;
	}
}
