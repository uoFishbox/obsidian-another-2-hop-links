import {
	cleanup,
	fireEvent,
	render,
	screen as domScreen,
	waitFor,
	within,
} from "@testing-library/svelte";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { ARIA_LABELS } from "../../../../appConstants";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
import LinkListHarness from "./VirtualGridLinkListHarness.svelte";
import LinkListObjectHarness from "./VirtualGridLinkListObjectHarness.svelte";
import {
	createDomRect,
	setElementRect,
	setNumericProperty,
	triggerResize,
	triggerIntersection,
	flushFrames,
	resetRecords,
	installResizeObserverMock,
	installIntersectionObserverMock,
	installAnimationFrameMock,
	teardownResizeObserverMock,
	teardownIntersectionObserverMock,
	teardownAnimationFrameMock,
} from "testing/helpers/DOMObserverMock";
import type {
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../virtual-list/renderRevision";

type TextMatcher = Parameters<typeof domScreen.queryAllByText>[0];

function collectOpenShadowRoots(root: ParentNode = document.body): ShadowRoot[] {
	const shadowRoots: ShadowRoot[] = [];

	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (!(element instanceof HTMLElement) || !element.shadowRoot) {
			continue;
		}

		shadowRoots.push(element.shadowRoot);
		shadowRoots.push(...collectOpenShadowRoots(element.shadowRoot));
	}

	return shadowRoots;
}

function queryAllByTestIdDeep(testId: string): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];

	for (const element of domScreen.queryAllByTestId(testId)) {
		if (!seen.has(element)) {
			seen.add(element);
			results.push(element);
		}
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		for (const element of within(
			shadowRoot as unknown as HTMLElement,
		).queryAllByTestId(testId)) {
			if (!seen.has(element)) {
				seen.add(element);
				results.push(element);
			}
		}
	}

	return results;
}

function queryAllByTextDeep(text: TextMatcher): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];

	for (const element of domScreen.queryAllByText(text)) {
		if (!seen.has(element)) {
			seen.add(element);
			results.push(element);
		}
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		for (const element of within(
			shadowRoot as unknown as HTMLElement,
		).queryAllByText(text)) {
			if (!seen.has(element)) {
				seen.add(element);
				results.push(element);
			}
		}
	}

	return results;
}

function queryAllByLabelTextDeep(text: TextMatcher): HTMLElement[] {
	const seen = new Set<HTMLElement>();
	const results: HTMLElement[] = [];

	for (const element of domScreen.queryAllByLabelText(text)) {
		if (!seen.has(element)) {
			seen.add(element);
			results.push(element);
		}
	}

	for (const shadowRoot of collectOpenShadowRoots()) {
		for (const element of within(
			shadowRoot as unknown as HTMLElement,
		).queryAllByLabelText(text)) {
			if (!seen.has(element)) {
				seen.add(element);
				results.push(element);
			}
		}
	}

	return results;
}

function getSingleMatch<T extends HTMLElement>(elements: T[], description: string): T {
	if (elements.length === 1) {
		return elements[0];
	}

	if (elements.length === 0) {
		throw new Error(`Unable to find an element by: ${description}`);
	}

	throw new Error(`Found multiple elements by: ${description}`);
}

const screen = {
	...domScreen,
	getAllByTestId(testId: string): HTMLElement[] {
		const elements = queryAllByTestIdDeep(testId);
		if (elements.length === 0) {
			throw new Error(`Unable to find an element by: [data-testid="${testId}"]`);
		}
		return elements;
	},
	queryAllByTestId(testId: string): HTMLElement[] {
		return queryAllByTestIdDeep(testId);
	},
	getByTestId(testId: string): HTMLElement {
		return getSingleMatch(
			queryAllByTestIdDeep(testId),
			`[data-testid="${testId}"]`,
		);
	},
	queryByTestId(testId: string): HTMLElement | null {
		const elements = queryAllByTestIdDeep(testId);
		return elements.length > 0 ? elements[0] : null;
	},
	getByText(text: TextMatcher): HTMLElement {
		return getSingleMatch(queryAllByTextDeep(text), `text: ${String(text)}`);
	},
	queryByText(text: TextMatcher): HTMLElement | null {
		const elements = queryAllByTextDeep(text);
		return elements.length > 0 ? elements[0] : null;
	},
	getByLabelText(text: TextMatcher): HTMLElement {
		return getSingleMatch(
			queryAllByLabelTextDeep(text),
			`label text: ${String(text)}`,
		);
	},
	queryByLabelText(text: TextMatcher): HTMLElement | null {
		const elements = queryAllByLabelTextDeep(text);
		return elements.length > 0 ? elements[0] : null;
	},
};

export function createItems(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `Item ${index}`);
}

function getRenderedItemIndexes(): number[] {
	return screen
		.queryAllByTestId("item-cell")
		.map((element) => Number(element.getAttribute("data-index")))
		.filter((n) => !Number.isNaN(n))
		.sort((left, right) => left - right);
}

function getRenderedItemIndexesInShadowRoot(host: HTMLElement | null): number[] {
	if (!host?.shadowRoot) {
		return [];
	}

	return Array.from(
		host.shadowRoot.querySelectorAll<HTMLElement>("[data-testid='item-cell']"),
	)
		.map((element) => Number(element.getAttribute("data-index")))
		.filter((n) => !Number.isNaN(n))
		.sort((left, right) => left - right);
}

function expectFocused(element: HTMLElement | null | undefined): void {
	expect(element).toBeTruthy();
	if (!element) {
		return;
	}

	const rootNode = element.getRootNode();
	if (rootNode instanceof ShadowRoot) {
		expect(rootNode.activeElement).toBe(element);
		return;
	}

	expect(element).toHaveFocus();
}

export interface RenderVirtualGridListOptions {
	items?: string[];
	showHeader?: boolean;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
	paginationMode?: "button" | "infinite-scroll";
	infiniteScrollRootMargin?: string;
	topSpacerHeight?: number;
}

export interface VirtualGridListDriver {
	container: HTMLElement;
	scrollRoot: HTMLElement;
	gridRoot: HTMLElement;

	setViewport(options: {
		rootHeight: number;
		width: number;
		sectionTop?: number;
		scrollTop?: number;
	}): Promise<void>;

	scrollTo(options: { scrollTop: number; sectionTop: number }): Promise<void>;

	resizeTo(options: {
		rootHeight?: number;
		width: number;
		gridHeight?: number;
	}): Promise<void>;

	renderedIndexes(): number[];
	renderedIndexesInShadowRoot(): number[];

	expectRenderedIndexes(options: {
		include?: number[];
		exclude?: number[];
		maxCount?: number;
		minCount?: number;
	}): void;

	getFocusTarget(index: number): HTMLElement;
	expectFocused(index: number): void;

	getLoadMoreButton(): HTMLElement;
	getSentinel(): HTMLElement | null;
	getShadowRoot(): ShadowRoot | null;
	getHeader(): HTMLElement | null;

	intersectSentinel(): void;
	setTopSpacerHeight(height: number): void;
	setGridRect(options: { sectionTop: number; width: number; height: number }): void;
	resizeGrid(options: { width: number; height: number }): Promise<void>;
}

function prepareVirtualGridLayout(
	container: HTMLElement,
	options: {
		rootHeight: number;
		width: number;
		sectionTop?: number;
		scrollTop?: number;
	},
): {
	scrollRoot: HTMLElement;
	virtualGrid: HTMLElement;
} {
	const scrollRoot = container.querySelector<HTMLElement>(
		"[data-testid='scroll-root']",
	);
	const virtualGrid = container.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);

	if (!scrollRoot || !virtualGrid) {
		throw new Error("Required elements not found");
	}

	const sectionTop = options.sectionTop ?? 0;
	setNumericProperty(scrollRoot, "clientHeight", options.rootHeight);
	setNumericProperty(scrollRoot, "scrollTop", options.scrollTop ?? 0);
	scrollRoot.style.overflow = "auto";
	setElementRect(scrollRoot, {
		top: 0,
		width: options.width,
		height: options.rootHeight,
	});
	virtualGrid.style.setProperty("--ccl-box-size", "100px");
	virtualGrid.style.setProperty("--ccl-box-height", "120px");
	virtualGrid.style.setProperty("--ccl-box-gap", "10px");
	virtualGrid.style.setProperty("--ccl-box-cols-max", "4");
	setElementRect(virtualGrid, {
		top: sectionTop,
		width: options.width,
		height: 2000,
	});
	triggerResize(virtualGrid, options.width, 2000);
	triggerResize(scrollRoot, options.width, options.rootHeight);

	return {
		scrollRoot,
		virtualGrid,
	};
}

export function renderVirtualGridList(
	options: RenderVirtualGridListOptions = {},
): VirtualGridListDriver {
	const {
		items = createItems(6),
		showHeader = false,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
		paginationMode = "button",
		infiniteScrollRootMargin = "0px 0px 900px 0px",
		topSpacerHeight = 0,
	} = options;

	const { container } = render(LinkListHarness, {
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

	const scrollRoot = container.querySelector<HTMLElement>(
		"[data-testid='scroll-root']",
	);
	const gridRoot = container.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);

	if (!scrollRoot || !gridRoot) {
		throw new Error("Required elements not found");
	}

	const driver: VirtualGridListDriver = {
		container,
		scrollRoot,
		gridRoot,

		async setViewport(viewportOptions) {
			const { rootHeight, width, sectionTop, scrollTop } = viewportOptions;
			setNumericProperty(scrollRoot, "clientHeight", rootHeight);
			setNumericProperty(scrollRoot, "scrollTop", scrollTop ?? 0);
			scrollRoot.style.overflow = "auto";
			setElementRect(scrollRoot, {
				top: 0,
				width,
				height: rootHeight,
			});
			gridRoot.style.setProperty("--ccl-box-size", "100px");
			gridRoot.style.setProperty("--ccl-box-height", "120px");
			gridRoot.style.setProperty("--ccl-box-gap", "10px");
			gridRoot.style.setProperty("--ccl-box-cols-max", "4");
			setElementRect(gridRoot, {
				top: sectionTop ?? 0,
				width,
				height: 2000,
			});
			triggerResize(gridRoot, width, 2000);
			triggerResize(scrollRoot, width, rootHeight);
			await flushFrames();
		},

		async scrollTo(scrollOptions) {
			const { scrollTop, sectionTop } = scrollOptions;
			setNumericProperty(scrollRoot, "scrollTop", scrollTop);
			setElementRect(gridRoot, {
				top: sectionTop,
				width: gridRoot.getBoundingClientRect().width,
				height: 2000,
			});
			await fireEvent.scroll(scrollRoot);
			await flushFrames();
		},

		async resizeTo(resizeOptions) {
			const { rootHeight, width, gridHeight } = resizeOptions;
			if (rootHeight !== undefined) {
				setNumericProperty(scrollRoot, "clientHeight", rootHeight);
				setElementRect(scrollRoot, {
					top: 0,
					width,
					height: rootHeight,
				});
				triggerResize(scrollRoot, width, rootHeight);
			}
			setElementRect(gridRoot, {
				top: gridRoot.getBoundingClientRect().top,
				width,
				height: gridHeight ?? 2000,
			});
			triggerResize(gridRoot, width, gridHeight ?? 2000);
			await flushFrames();
		},

		renderedIndexes() {
			return getRenderedItemIndexes();
		},

		renderedIndexesInShadowRoot() {
			return getRenderedItemIndexesInShadowRoot(gridRoot);
		},

		expectRenderedIndexes(assertionOptions) {
			const { include, exclude, maxCount, minCount } = assertionOptions;
			const indexes = driver.renderedIndexes();

			if (include) {
				for (const index of include) {
					expect(indexes).toContain(index);
				}
			}
			if (exclude) {
				for (const index of exclude) {
					expect(indexes).not.toContain(index);
				}
			}
			if (maxCount !== undefined) {
				expect(indexes.length).toBeLessThanOrEqual(maxCount);
			}
			if (minCount !== undefined) {
				expect(indexes.length).toBeGreaterThanOrEqual(minCount);
			}
		},

		getFocusTarget(index: number) {
			const targets = screen.getAllByTestId("item-focus-target");
			const target = targets.find(
				(el) => el.getAttribute("data-index") === String(index),
			);
			if (!target) {
				throw new Error(`Focus target for index ${index} not found`);
			}
			return target;
		},

		expectFocused(index: number) {
			const target = driver.getFocusTarget(index);
			expectFocused(target);
		},

		getLoadMoreButton() {
			return screen.getByLabelText(ARIA_LABELS.LOAD_MORE);
		},

		getSentinel() {
			return container.querySelector<HTMLElement>(
				".cosense-card-links__infinite-scroll-sentinel",
			);
		},

		getShadowRoot() {
			return gridRoot.shadowRoot;
		},

		getHeader() {
			return screen.queryByTestId("header-cell");
		},

		intersectSentinel() {
			const sentinel = driver.getSentinel();
			if (!sentinel) {
				throw new Error("Sentinel not found");
			}
			setElementRect(sentinel, {
				top: 0,
				width: 1,
				height: 1,
			});
			triggerIntersection(sentinel);
		},

		setTopSpacerHeight(height: number) {
			const spacer = container.querySelector<HTMLElement>(
				"[data-testid='top-spacer']",
			);
			if (!spacer) {
				throw new Error("Spacer not found");
			}
			spacer.style.height = `${height}px`;
		},

		setGridRect(rectOptions) {
			const { sectionTop, width, height } = rectOptions;
			setElementRect(gridRoot, {
				top: sectionTop,
				width,
				height,
			});
		},

		async resizeGrid(resizeGridOptions) {
			const { width, height } = resizeGridOptions;
			triggerResize(gridRoot, width, height);
			await flushFrames();
		},
	};

	return driver;
}

export interface HarnessItem {
	id: string;
	label: string;
	renderVersion?: RenderRevision;
}

export interface RenderVirtualGridListObjectOptions {
	items: HarnessItem[];
	itemsRevision?: unknown;
	itemRenderRevisionToken?: RenderRevision;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
	initialVisibleCount?: number;
	loadMoreIncrement?: number;
	useItemRenderRevision?: boolean;
	onMountedCellsChange?: (cells: readonly unknown[]) => void;
}

export interface VirtualGridListObjectDriver {
	container: HTMLElement;
	scrollRoot: HTMLElement;
	gridRoot: HTMLElement;

	setViewport(options: {
		rootHeight: number;
		width: number;
		sectionTop?: number;
		scrollTop?: number;
	}): Promise<void>;

	rerender(props: {
		items: HarnessItem[];
		itemsRevision?: unknown;
		itemRenderRevisionToken?: RenderRevision;
		renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
		useItemRenderRevision?: boolean;
	}): Promise<void>;

	getCellByItemId(id: string): HTMLElement | null;
	queryByText(text: string): HTMLElement | null;
}

export function renderVirtualGridListObject(
	options: RenderVirtualGridListObjectOptions,
): VirtualGridListObjectDriver {
	const {
		items,
		itemsRevision,
		itemRenderRevisionToken,
		renderRevisionFallbackPolicy,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
		useItemRenderRevision = false,
		onMountedCellsChange,
	} = options;

	const view = render(LinkListObjectHarness, {
		props: {
			items,
			itemsRevision,
			itemRenderRevisionToken,
			renderRevisionFallbackPolicy,
			initialVisibleCount,
			loadMoreIncrement,
			useItemRenderRevision,
			onMountedCellsChange,
		},
	});

	const scrollRoot = view.container.querySelector<HTMLElement>(
		"[data-testid='scroll-root']",
	);
	const gridRoot = view.container.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);

	if (!scrollRoot || !gridRoot) {
		throw new Error("Required elements not found");
	}

	const driver: VirtualGridListObjectDriver = {
		container: view.container,
		scrollRoot,
		gridRoot,

		async setViewport(viewportOptions) {
			const { rootHeight, width, sectionTop, scrollTop } = viewportOptions;
			setNumericProperty(scrollRoot, "clientHeight", rootHeight);
			setNumericProperty(scrollRoot, "scrollTop", scrollTop ?? 0);
			scrollRoot.style.overflow = "auto";
			setElementRect(scrollRoot, {
				top: 0,
				width,
				height: rootHeight,
			});
			gridRoot.style.setProperty("--ccl-box-size", "100px");
			gridRoot.style.setProperty("--ccl-box-height", "120px");
			gridRoot.style.setProperty("--ccl-box-gap", "10px");
			gridRoot.style.setProperty("--ccl-box-cols-max", "4");
			setElementRect(gridRoot, {
				top: sectionTop ?? 0,
				width,
				height: 2000,
			});
			triggerResize(gridRoot, width, 2000);
			triggerResize(scrollRoot, width, rootHeight);
			await flushFrames();
		},

		async rerender(rerenderOptions) {
			await view.rerender({
				items: rerenderOptions.items,
				itemsRevision: rerenderOptions.itemsRevision,
				itemRenderRevisionToken: rerenderOptions.itemRenderRevisionToken,
				renderRevisionFallbackPolicy:
					rerenderOptions.renderRevisionFallbackPolicy ??
					renderRevisionFallbackPolicy,
				initialVisibleCount,
				loadMoreIncrement,
				useItemRenderRevision:
					rerenderOptions.useItemRenderRevision ?? useItemRenderRevision,
			});
			await flushFrames();
		},

		getCellByItemId(id: string) {
			const cells = queryAllByTestIdDeep("object-item-cell");
			return cells.find((el) => el.getAttribute("data-item-id") === id) ?? null;
		},

		queryByText(text: string) {
			const elements = queryAllByTextDeep(text);
			return elements.length > 0 ? elements[0] : null;
		},
	};

	return driver;
}

export function setupVirtualGridTestEnvironment(): void {
	beforeEach(() => {
		resetRecords();
		installResizeObserverMock();
		installIntersectionObserverMock();
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		getLazyLoadManager().cleanup();
		teardownResizeObserverMock();
		teardownIntersectionObserverMock();
		teardownAnimationFrameMock();
	});
}
