import { vi } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type { ListConfig } from "../types";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ISortService } from "types/services";
import SearchableItemListItemStub from "./SearchableItemListItemStub.svelte";

export function createSearchableListStore(
	overrides: Partial<ApplicationStore> = {},
): ApplicationStore {
	const expandedLimits = new Map<string, number>();

	return {
		sortOption: "alphabetical",
		initialVisibleCount: 10,
		loadMoreIncrement: 10,
		settings: {},
		setSortOption: vi.fn(),
		getDefaultSectionVisibleLimit: vi.fn(() => 10),
		getSectionExpandedLimit: vi.fn((sectionId) => expandedLimits.get(sectionId)),
		setSectionExpandedLimit: vi.fn((sectionId, limit) => {
			expandedLimits.set(sectionId, limit);
		}),
		updateVersion: 0,
		...overrides,
	} as unknown as ApplicationStore;
}

export function createSortService(
	sort: ISortService["sort"] = (items) => items,
): ISortService {
	return {
		sort: vi.fn(sort) as ISortService["sort"],
	};
}

export function createFileItem(file: TFile): ViewItem {
	return {
		type: "file",
		data: file,
	} as ViewItem;
}

export function createTaggedNoteItem(file: TFile): ViewItem {
	return {
		type: "taggedNote",
		data: {
			file,
			commonTags: ["alpha"],
			path: file.path,
		},
	} as ViewItem;
}

export function createTaggedNoteData(file: TFile): ViewItem["data"] {
	return {
		file,
		commonTags: ["alpha"],
		path: file.path,
	};
}

export function createTaggedNoteItemFromData(data: ViewItem["data"]): ViewItem {
	return {
		type: "taggedNote",
		data,
	} as ViewItem;
}

export function createLinkContext(
	sourceFile: TFile,
	fileToLinktext: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string = (file) => file.basename,
): LinkContext {
	return {
		resolveFile: vi.fn(() => null),
		fileToLinktext,
		buildWikiLink: vi.fn(() => "[[alpha]]"),
		getPreview: vi.fn(async () => ({ type: "empty", content: "" }) as const),
		sourceFile,
		getMetadata: vi.fn(() => null),
		onOpenFile: vi.fn(),
		onHop1Click: vi.fn(),
		onHop2Click: vi.fn(),
		onTagClick: vi.fn(),
	};
}

export function createConfig(): ListConfig<ViewItem> {
	return {
		title: "Searchable",
		itemComponent: SearchableItemListItemStub,
		getItemProps: (item) => ({
			label:
				item.type === "taggedNote"
					? item.data.file.basename
					: item.type === "file"
						? item.data.basename
						: "unknown",
		}),
		getItemKey: (item: ViewItem) => {
			switch (item.type) {
				case "backlink":
					return item.data.sourceFile.path;
				case "taggedNote":
					return item.data.path;
				case "file":
					return item.data.path;
				case "branch":
					return item.data.hop1.path ?? item.data.hop1.rawText;
				case "newLink":
					return (
						item.data.path ??
						`${item.data.sourceFile.path}:${item.data.rawText}`
					);
				default:
					return "";
			}
		},
		sectionId: "searchable-items",
		emptyMessage: "No items",
		searchEnabled: true,
	};
}
