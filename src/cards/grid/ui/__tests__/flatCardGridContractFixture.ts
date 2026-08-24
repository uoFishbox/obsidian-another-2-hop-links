import { render } from "@testing-library/svelte";
import { expect } from "vitest";
import FlatCardGridHarness from "./FlatCardGridHarness.svelte";
import FlatCardGridObjectHarness from "./FlatCardGridObjectHarness.svelte";
import {
	flushFrames,
	setElementRect,
	setNumericProperty,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import {
	queryAllByTestIdDeep,
	queryAllByTextDeep,
} from "testing/helpers/shadowDomQueries";
import {
	createItems,
	getFlatCardGridElements,
	scrollFlatCardGrid,
	setFlatCardGridViewport,
	type FlatCardGridViewportOptions,
} from "./flatCardGridTestEnvironment";

export interface RenderFlatCardGridContractOptions {
	readonly items?: string[];
	readonly showHeader?: boolean;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
	readonly paginationMode?: "button" | "infinite-scroll";
	readonly infiniteScrollRootMargin?: string;
	readonly topSpacerHeight?: number;
}

export interface FlatCardGridContractFixture {
	setViewport(options: FlatCardGridViewportOptions): Promise<void>;
	scrollTo(options: {
		readonly scrollTop: number;
		readonly sectionTop: number;
	}): Promise<void>;
	resizeTo(options: {
		readonly rootHeight?: number;
		readonly width: number;
		readonly gridHeight?: number;
	}): Promise<void>;
	mountedLogicalIndexes(): number[];
	mountedLogicalIndexesInShadowRoot(): number[];
	expectMountedLogicalIndexes(options: {
		readonly include?: number[];
		readonly exclude?: number[];
		readonly maxCount?: number;
		readonly minCount?: number;
	}): void;
	getShadowRoot(): ShadowRoot | null;
	getHeader(): HTMLElement | null;
	getInfiniteScrollSentinel(): HTMLElement | null;
	setTopSpacerHeight(height: number): void;
	setGridRect(options: {
		readonly sectionTop: number;
		readonly width: number;
		readonly height: number;
	}): void;
	resizeGrid(options: {
		readonly width: number;
		readonly height: number;
	}): Promise<void>;
}

function readLogicalIndexes(elements: readonly HTMLElement[]): number[] {
	return elements
		.map((element) => Number(element.getAttribute("data-index")))
		.filter((index) => !Number.isNaN(index))
		.sort((left, right) => left - right);
}

/** Renders FlatCardGrid with geometry and physical-DOM inspection enabled. */
export function renderFlatCardGridContract(
	options: RenderFlatCardGridContractOptions = {},
): FlatCardGridContractFixture {
	const {
		items = createItems(6),
		showHeader = false,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
		paginationMode = "button",
		infiniteScrollRootMargin = "0px 0px 900px 0px",
		topSpacerHeight = 0,
	} = options;
	const { container } = render(FlatCardGridHarness, {
		props: {
			items,
			showHeader,
			initialVisibleCount,
			loadMoreIncrement,
			paginationMode,
			infiniteScrollRootMargin,
			topSpacerHeight,
		},
	});
	const elements = getFlatCardGridElements(container);

	const fixture: FlatCardGridContractFixture = {
		setViewport: (viewportOptions) =>
			setFlatCardGridViewport(elements, viewportOptions),

		scrollTo: (scrollOptions) => scrollFlatCardGrid(elements, scrollOptions),

		async resizeTo(resizeOptions) {
			const { rootHeight, width, gridHeight } = resizeOptions;
			if (rootHeight !== undefined) {
				setNumericProperty(elements.scrollRoot, "clientHeight", rootHeight);
				setElementRect(elements.scrollRoot, {
					top: 0,
					width,
					height: rootHeight,
				});
				triggerResize(elements.scrollRoot, width, rootHeight);
			}
			setElementRect(elements.gridRoot, {
				top: elements.gridRoot.getBoundingClientRect().top,
				width,
				height: gridHeight ?? 2000,
			});
			triggerResize(elements.gridRoot, width, gridHeight ?? 2000);
			await flushFrames();
		},

		mountedLogicalIndexes: () =>
			readLogicalIndexes(queryAllByTestIdDeep("item-cell")),

		mountedLogicalIndexesInShadowRoot: () =>
			readLogicalIndexes(
				Array.from(
					elements.gridRoot.shadowRoot?.querySelectorAll<HTMLElement>(
						"[data-testid='item-cell']",
					) ?? [],
				),
			),

		expectMountedLogicalIndexes(assertionOptions) {
			const indexes = fixture.mountedLogicalIndexes();
			for (const index of assertionOptions.include ?? []) {
				expect(indexes).toContain(index);
			}
			for (const index of assertionOptions.exclude ?? []) {
				expect(indexes).not.toContain(index);
			}
			if (assertionOptions.maxCount !== undefined) {
				expect(indexes.length).toBeLessThanOrEqual(assertionOptions.maxCount);
			}
			if (assertionOptions.minCount !== undefined) {
				expect(indexes.length).toBeGreaterThanOrEqual(
					assertionOptions.minCount,
				);
			}
		},

		getShadowRoot: () => elements.gridRoot.shadowRoot,
		getHeader: () => queryAllByTestIdDeep("header-cell")[0] ?? null,
		getInfiniteScrollSentinel: () =>
			container.querySelector<HTMLElement>(
				".cosense-card-links__infinite-scroll-sentinel",
			),

		setTopSpacerHeight(height) {
			const spacer = container.querySelector<HTMLElement>(
				"[data-testid='top-spacer']",
			);
			if (!spacer) {
				throw new Error("Top spacer was not rendered");
			}
			spacer.style.height = `${height}px`;
		},

		setGridRect(rectOptions) {
			setElementRect(elements.gridRoot, {
				top: rectOptions.sectionTop,
				width: rectOptions.width,
				height: rectOptions.height,
			});
		},

		async resizeGrid(resizeOptions) {
			triggerResize(elements.gridRoot, resizeOptions.width, resizeOptions.height);
			await flushFrames();
		},
	};

	return fixture;
}

export interface HarnessItem {
	readonly id: string;
	label: string;
}

export interface RenderFlatCardGridObjectContractOptions {
	readonly items: HarnessItem[];
	readonly itemsRevision?: unknown;
	readonly initialVisibleCount?: number;
	readonly loadMoreIncrement?: number;
}

export interface FlatCardGridObjectContractFixture {
	setViewport(options: FlatCardGridViewportOptions): Promise<void>;
	rerender(props: {
		readonly items: HarnessItem[];
		readonly itemsRevision?: unknown;
	}): Promise<void>;
	queryByText(text: string): HTMLElement | null;
}

/** Renders object-identity scenarios for FlatCardGrid contract tests. */
export function renderFlatCardGridObjectContract(
	options: RenderFlatCardGridObjectContractOptions,
): FlatCardGridObjectContractFixture {
	const {
		items,
		itemsRevision,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
	} = options;
	const view = render(FlatCardGridObjectHarness, {
		props: {
			items,
			itemsRevision,
			initialVisibleCount,
			loadMoreIncrement,
		},
	});
	const elements = getFlatCardGridElements(view.container);

	return {
		setViewport: (viewportOptions) =>
			setFlatCardGridViewport(elements, viewportOptions),

		async rerender(rerenderOptions) {
			await view.rerender({
				items: rerenderOptions.items,
				itemsRevision: rerenderOptions.itemsRevision,
				initialVisibleCount,
				loadMoreIncrement,
			});
			await flushFrames();
		},
		queryByText: (text) => queryAllByTextDeep(text)[0] ?? null,
	};
}
