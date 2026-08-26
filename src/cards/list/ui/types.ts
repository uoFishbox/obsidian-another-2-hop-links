import type { LinkContext } from "cards/context/linkContext";
import type { ListViewState } from "cards/list/model/ListViewState";
import type { ISortService, SortOption } from "cards/sorting";
import type { App } from "obsidian";
import type { CardItem } from "cards/CardItem";

export interface ListProps<T> {
	items: T[];
	linkContext: LinkContext;
	applicationStore: ListViewState;
	sortService: ISortService;
	app: App;
}

export interface ListConfig<T = CardItem> {
	title: string;
	paginationMode?: "button" | "infinite-scroll";
	preserveResultsHeightOnSearch?: boolean;
	showSectionHeader?: boolean;
	sectionHeaderTitle?: string;
	searchEnabled?: boolean;
	allowContentSearch?: boolean;
	searchPlaceholder?: string;
	getSearchText?: (item: T, linkContext: LinkContext) => string;
	onSearchSubmit?: (value: string) => void | Promise<void>;
	/** Unique semantic identity that remains stable across filtering and sorting. */
	getItemKey: (item: T) => string;
	/** Optional owner-level sorted-result cache for stable item collections. */
	getSortedItems?: (option: SortOption) => T[];
	sectionId: string;
	pinBookmarkedToTop?: boolean;
	emptyMessage: string;
}
