import { fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import { getTwoHopCardCounts } from "infrastructure/debug/twoHopCardCountRegistry";
import type { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import {
	flushFrames,
	installAnimationFrameMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownAnimationFrameMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import TwoHopVirtualGridHarness from "./TwoHopVirtualGridHarness.svelte";

function createSection(count: number, totalCount = count): TwoHopSectionModel {
	const items = Array.from({ length: count }, (_, index) => ({
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		key: `item:${index}`,
	})) as TwoHopItemModel[];
	return createTwoHopSectionModel({
		id: "section",
		kind: "new-links-section",
		title: "Section",
		items,
		totalCount,
	});
}

function createCardModelResolver() {
	return vi.fn(
		(item: TwoHopItemModel, _revision: unknown): CardRenderModel => ({
			item: item.item,
			targetFile: null,
			title: item.key,
			ariaLabel: item.key,
			className: null,
			extension: null,
			interactionId: item.key,
			interactionDescriptor: null,
			searchQuery: "",
			previewRequest: null,
		}),
	);
}

interface SurfaceFixture {
	readonly root: HTMLElement;
	readonly scroller: HTMLElement;
	readonly rerender: ReturnType<typeof render>["rerender"];
	readonly publishSection: (
		section: TwoHopSectionModel,
		cardModelRevision?: unknown,
	) => Promise<void>;
}

async function renderSurface(params: {
	section: TwoHopSectionModel;
	resolveItemCardModel: ReturnType<typeof createCardModelResolver>;
	loadMoreSection?: (sectionId: string) => void;
	rootTop?: number;
	cardModelRevision?: unknown;
}): Promise<SurfaceFixture> {
	const applicationStore = {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 100,
			cardHeightRatio: 1,
			cardMaxColumns: 3,
		},
	} as unknown as ApplicationUiState;
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientWidth", 320);
	setNumericProperty(scroller, "clientHeight", 300);
	setNumericProperty(scroller, "scrollHeight", 40_000);
	setNumericProperty(scroller, "scrollTop", 0);
	setElementRect(scroller, { top: 0, width: 320, height: 300 });
	document.body.append(scroller);

	const baseProps = {
		sections: [params.section],
		applicationStore,
		linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
		loadMoreSection: params.loadMoreSection,
		resolveItemCardModel: params.resolveItemCardModel,
		cardModelRevision: params.cardModelRevision ?? 0,
	};
	const rendered = render(TwoHopVirtualGridHarness, {
		target: scroller,
		props: baseProps,
	});
	const root = rendered.container.querySelector<HTMLElement>(
		".twohop-virtual-surface",
	);
	if (!root) throw new Error("Two-hop virtual surface was not rendered");
	setElementRect(root, {
		top: params.rootTop ?? 0,
		width: 320,
		height: 40_000,
	});
	triggerResize(root, 320, 40_000);
	for (let index = 0; index < 4; index += 1) await flushFrames();

	return {
		root,
		scroller,
		rerender: rendered.rerender,
		publishSection: (section, cardModelRevision = baseProps.cardModelRevision) =>
			rendered.rerender({
				...baseProps,
				sections: [section],
				cardModelRevision,
			}),
	};
}

function getRows(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.shadowRoot?.querySelectorAll<HTMLElement>(".twohop-virtual-row") ?? [],
	);
}

async function waitForStableRowCount(root: HTMLElement): Promise<number> {
	let previousRowCount = -1;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const rowCount = getRows(root).length;
		if (rowCount === previousRowCount) return rowCount;
		previousRowCount = rowCount;
		await flushFrames();
	}
	return previousRowCount;
}

beforeEach(() => {
	resetRecords();
	installResizeObserverMock();
	installAnimationFrameMock();
	setNumericProperty(window, "scrollY", 0);
});

afterEach(() => {
	teardownAnimationFrameMock();
	teardownResizeObserverMock();
});

describe("TwoHopVirtualGrid component", () => {
	it("keeps resident DOM bounded and reuses physical row slots across a long scroll", async () => {
		const resolver = createCardModelResolver();
		const { root, scroller } = await renderSurface({
			section: createSection(10_000),
			resolveItemCardModel: resolver,
		});

		await vi.waitFor(() => expect(getRows(root).length).toBeGreaterThan(0));
		const initialRows = getRows(root);
		const initialBySlot = new Map(
			initialRows.map((row) => [row.dataset.cclRowSlot, row]),
		);
		expect(initialRows.length).toBeLessThanOrEqual(12);

		setNumericProperty(scroller, "scrollTop", 20_000);
		await fireEvent.scroll(scroller);
		await vi.waitFor(() => {
			const rowIndexes = getRows(root).map((row) =>
				Number(row.dataset.cclRowIndex),
			);
			expect(Math.min(...rowIndexes)).toBeGreaterThan(100);
		});

		const scrolledRows = getRows(root);
		expect(scrolledRows.length).toBeLessThanOrEqual(12);
		const reusedRows = scrolledRows.filter(
			(row) => initialBySlot.get(row.dataset.cclRowSlot) === row,
		);
		expect(reusedRows.length).toBe(initialRows.length);
		expect(
			root.shadowRoot?.querySelector(".twohop-progressive-sentinel"),
		).toBeNull();
		expect(root.shadowRoot?.querySelector(".twohop-progressive-chunk")).toBeNull();
	});

	it("hydrates mounted cards after measurement without synchronously resolving the full source", async () => {
		const resolver = createCardModelResolver();
		const fixturePromise = renderSurface({
			section: createSection(10_000),
			resolveItemCardModel: resolver,
		});
		expect(resolver).not.toHaveBeenCalled();
		const { root } = await fixturePromise;

		await vi.waitFor(() => expect(resolver).toHaveBeenCalled());
		expect(resolver.mock.calls.length).toBeLessThan(40);
		expect(
			root.shadowRoot?.querySelector("[data-ccl-interaction-id='item:0']"),
		).not.toBeNull();
	});

	it("retains valid hydrated models across filtered publications and invalidates precise changes", async () => {
		const resolver = createCardModelResolver();
		const fullSection = createSection(20);
		const { publishSection } = await renderSurface({
			section: fullSection,
			resolveItemCardModel: resolver,
		});

		await vi.waitFor(() => expect(resolver).toHaveBeenCalled());
		const filteredItems = fullSection.items.slice(0, 5);
		const createFilteredSection = (items: readonly TwoHopItemModel[]) =>
			createTwoHopSectionModel({
				id: fullSection.id,
				kind: fullSection.kind,
				title: fullSection.title,
				items,
				totalCount: items.length,
			});

		resolver.mockClear();
		await publishSection(createFilteredSection(filteredItems));
		for (let index = 0; index < 4; index += 1) await flushFrames();
		expect(resolver).not.toHaveBeenCalled();

		const replacement = { ...filteredItems[0]! };
		await publishSection(
			createFilteredSection([replacement, ...filteredItems.slice(1)]),
		);
		await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
		expect(resolver.mock.calls[0]?.[0]).toBe(replacement);

		resolver.mockClear();
		await publishSection(createFilteredSection(filteredItems), 1);
		await vi.waitFor(() => expect(resolver).toHaveBeenCalled());
		expect(resolver.mock.calls.every((call) => call[1] === 1)).toBe(true);
	});

	it("preserves the visible anchor while prepending one row of items", async () => {
		const resolver = createCardModelResolver();
		const section = createSection(100);
		const { publishSection, root, scroller } = await renderSurface({
			section,
			resolveItemCardModel: resolver,
		});
		setNumericProperty(scroller, "scrollTop", 1_000);
		await fireEvent.scroll(scroller);
		await vi.waitFor(() => {
			const rowIndexes = getRows(root).map((row) =>
				Number(row.dataset.cclRowIndex),
			);
			expect(Math.min(...rowIndexes)).toBeGreaterThan(0);
		});
		const scrollTopBeforePublication = scroller.scrollTop;
		const prependedItems: TwoHopItemModel[] = Array.from(
			{ length: 3 },
			(_, index) => ({
				...section.items[index]!,
				interactionId: `prepended:${index}`,
				searchKey: `prepended:${index}`,
				key: `prepended:${index}`,
			}),
		);

		await publishSection(
			createTwoHopSectionModel({
				id: section.id,
				kind: section.kind,
				title: section.title,
				items: [...prependedItems, ...section.items],
				totalCount: section.totalCount + prependedItems.length,
			}),
		);

		expect(scroller.scrollTop).toBeGreaterThan(scrollTopBeforePublication);
	});

	it("renders load-more as a virtual cell and accepts the expanded publication", async () => {
		const resolver = createCardModelResolver();
		const loadMoreSection = vi.fn();
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationUiState;
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientWidth", 320);
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 2_000);
		setNumericProperty(scroller, "scrollTop", 0);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		document.body.append(scroller);
		const baseProps = {
			sections: [createSection(2, 3)],
			applicationStore,
			linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
			loadMoreSection,
			resolveItemCardModel: resolver,
		};
		const rendered = render(TwoHopVirtualGridHarness, {
			target: scroller,
			props: baseProps,
		});
		const root = rendered.container.querySelector<HTMLElement>(
			".twohop-virtual-surface",
		);
		if (!root) throw new Error("Two-hop virtual surface was not rendered");
		setElementRect(root, { top: 0, width: 320, height: 2_000 });
		triggerResize(root, 320, 2_000);

		const button = await vi.waitFor(() => {
			const candidate = root.shadowRoot?.querySelector<HTMLButtonElement>(
				".cosense-card-links__load-more-button",
			);
			expect(candidate).not.toBeNull();
			return candidate!;
		});
		expect(getTwoHopCardCounts(root)).toEqual({
			header: 1,
			item: 2,
			loadMore: 1,
			total: 4,
		});
		await fireEvent.click(button);
		expect(loadMoreSection).toHaveBeenCalledWith("section");

		await rendered.rerender({
			...baseProps,
			sections: [createSection(3)],
		});
		await vi.waitFor(() =>
			expect(
				root.shadowRoot?.querySelector(".cosense-card-links__load-more-button"),
			).toBeNull(),
		);
		expect(getTwoHopCardCounts(root)).toEqual({
			header: 1,
			item: 3,
			loadMore: 0,
			total: 4,
		});
	});

	it("clears the stale card model when a physical slot rebinds to another item", async () => {
		const resolver = createCardModelResolver();
		const section = createSection(20);
		const { root, publishSection } = await renderSurface({
			section,
			resolveItemCardModel: resolver,
		});

		const resolveFirstItemShell = (): Element | null =>
			getRows(root)[0]
				?.querySelector('[data-testid="twohop-virtual-item-cell"]')
				?.querySelector(".cosense-card-links__box") ?? null;
		await vi.waitFor(() =>
			expect(resolveFirstItemShell()?.textContent).toContain("item:0"),
		);

		const replacementItems: TwoHopItemModel[] = Array.from(
			{ length: 3 },
			(_, index) => ({
				item: { type: "newLink" },
				interactionId: `replaced:${index}`,
				searchKey: `replaced:${index}`,
				key: `replaced:${index}`,
			}),
		) as TwoHopItemModel[];
		await publishSection(
			createTwoHopSectionModel({
				id: section.id,
				kind: section.kind,
				title: section.title,
				items: [...replacementItems, ...section.items.slice(3)],
				totalCount: section.totalCount,
			}),
		);

		const shellAfterRebind = resolveFirstItemShell();
		expect(shellAfterRebind?.className).toContain("is-skeleton");
		expect(shellAfterRebind?.textContent).not.toContain("item:0");

		await vi.waitFor(() =>
			expect(resolveFirstItemShell()?.textContent).toContain("replaced:0"),
		);
		expect(resolveFirstItemShell()?.className).not.toContain("is-skeleton");
	});
});
