import type { LinkContext } from "ui/context/linkContext";
import type { ListViewState } from "features/list-view/model/ListViewState";
import type { ISortService } from "core/sorting";
import type { App } from "obsidian";
import type { ViewItem } from "application/presenters/ViewItem";

export interface ListProps<T> {
	items: T[];
	linkContext: LinkContext;
	applicationStore: ListViewState;
	sortService: ISortService;
	app: App;
}

export interface ListConfig<T = ViewItem> {
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
	getItemKey: (item: T, index?: number) => string;
	sectionId: string;
	pinBookmarkedToTop?: boolean;
	emptyMessage: string;
}
