import { fireEvent, render } from "@testing-library/svelte";
import { expect } from "vitest";
import { ARIA_LABELS } from "appConstants";
import {
	queryAllByRoleDeep,
	queryAllByTestIdDeep,
} from "testing/helpers/shadowDomQueries";
import {
	getFlatCardGridElements,
	setFlatCardGridViewport,
	type FlatCardGridViewportOptions,
} from "./flatCardGridTestEnvironment";
import FlatCardGridHarness from "./FlatCardGridHarness.svelte";
import { setElementRect, triggerIntersection } from "testing/helpers/DOMObserverMock";

export interface RenderFlatCardGridBehaviorOptions {
	readonly items: string[];
	readonly showHeader?: boolean;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationMode?: "button" | "infinite-scroll";
	readonly infiniteScrollRootMargin?: string;
}

export interface FlatCardGridBehaviorDriver {
	setViewport(options: FlatCardGridViewportOptions): Promise<void>;
	visibleItems(): string[];
	getItem(label: string): HTMLElement;
	expectFocusedItem(label: string): void;
	clickLoadMore(): Promise<void>;
	hasLoadMoreButton(): boolean;
	hasInfiniteScrollTrigger(): boolean;
	triggerInfiniteScroll(): void;
}

function getItemElements(): HTMLElement[] {
	return queryAllByTestIdDeep("item-focus-target");
}

function queryLoadMoreButton(): HTMLElement | null {
	return queryAllByRoleDeep("button", { name: ARIA_LABELS.LOAD_MORE })[0] ?? null;
}

/** Renders FlatCardGrid through a user-behavior-only test API. */
export function renderFlatCardGridBehavior(
	options: RenderFlatCardGridBehaviorOptions,
): FlatCardGridBehaviorDriver {
	const {
		items,
		showHeader = false,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
		paginationMode = "button",
		infiniteScrollRootMargin = "0px 0px 900px 0px",
	} = options;
	const { container } = render(FlatCardGridHarness, {
		props: {
			items,
			showHeader,
			initialVisibleCount,
			loadMoreIncrement,
			paginationMode,
			infiniteScrollRootMargin,
		},
	});
	const elements = getFlatCardGridElements(container);

	return {
		setViewport: (viewportOptions) =>
			setFlatCardGridViewport(elements, viewportOptions),

		visibleItems: () =>
			getItemElements().map((element) => element.textContent?.trim() ?? ""),

		getItem(label) {
			const item = getItemElements().find(
				(element) => element.textContent?.trim() === label,
			);
			if (!item) {
				throw new Error(`Visible item not found: ${label}`);
			}
			return item;
		},

		expectFocusedItem(label) {
			const item = this.getItem(label);
			const rootNode = item.getRootNode();
			expect(
				rootNode instanceof ShadowRoot
					? rootNode.activeElement
					: document.activeElement,
			).toBe(item);
		},

		async clickLoadMore() {
			const button = queryLoadMoreButton();
			if (!button) {
				throw new Error("Load more button was not rendered");
			}
			await fireEvent.click(button);
		},

		hasLoadMoreButton: () => queryLoadMoreButton() !== null,

		hasInfiniteScrollTrigger: () =>
			container.querySelector(".cosense-card-links__infinite-scroll-sentinel") !==
			null,

		triggerInfiniteScroll() {
			const sentinel = container.querySelector<HTMLElement>(
				".cosense-card-links__infinite-scroll-sentinel",
			);
			if (!sentinel) {
				throw new Error("Infinite-scroll trigger was not rendered");
			}
			setElementRect(sentinel, { top: 0, width: 1, height: 1 });
			triggerIntersection(sentinel);
		},
	};
}
