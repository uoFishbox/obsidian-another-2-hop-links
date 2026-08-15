import type { Component } from "svelte";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ISortService } from "core/sorting";
import type { App } from "obsidian";
import type { ViewItem } from "application/presenters";

export interface ListProps<T> {
	items: T[];
	linkContext: LinkContext;
	applicationStore: ApplicationStore;
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
	itemComponent: Component<any>;
	getItemProps: (item: T) => Record<string, unknown>;
	getItemKey: (item: T, index?: number) => string;
	sectionId: string;
	headerAction?: {
		label: string;
		onClick: () => void;
	};
	pinBookmarkedToTop?: boolean;
	emptyMessage: string;
	onKeyPress?: Record<string, () => void>;
}
