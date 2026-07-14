import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "types/settings";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
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
import TwoHopViewPlanVirtualListPerfHarness from "./TwoHopVirtualListSurfacePerfHarness.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";

const CARD_COUNTS = [100, 1_000, 10_000] as const;

const applicationStore = {
	settings: {
		...DEFAULT_SETTINGS,
		cardWidthPx: 100,
		cardHeightRatio: 1.2,
		cardGapPx: 10,
		cardMaxColumns: 3,
		sectionMarginBottomPx: 20,
	},
} as unknown as ApplicationStore;

const createItem = (index: number): TwoHopVirtualListItem => ({
	kind: "new-link",
	item: { type: "link" } as unknown as TwoHopVirtualListItem["item"],
	interactionId: `item:test:${index}`,
	searchKey: `item-${index}`,
	virtualKey: `item-${index}`,
});

const createDescriptor = (
	cardCount: number,
): SectionRenderDescriptor<TwoHopVirtualListItem, TwoHopVirtualListSection> => {
	const items = Array.from({ length: cardCount }, (_, index) => createItem(index));
	const section = {
		kind: "new-links-section",
		rawSectionId: "new-links",
		sectionId: "new-links",
		sectionKey: "new-links",
		title: "New links",
		getKey: () => "",
	} satisfies TwoHopVirtualListSection;

	return {
		section,
		sectionKey: section.sectionKey,
		title: section.title,
		sectionId: section.sectionId,
		totalCount: cardCount,
		loadedCount: cardCount,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
};

describe("TwoHopViewPlanVirtualList DOM performance contracts", () => {
	beforeEach(() => {
		resetRecords();
		installResizeObserverMock();
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		teardownResizeObserverMock();
		teardownAnimationFrameMock();
	});

	it.each(CARD_COUNTS)(
		"bounds Shadow DOM cells for %i logical items",
		async (cardCount) => {
			const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
				props: {
					sections: [createDescriptor(cardCount)],
					applicationStore,
				},
			});
			const scrollRoot = container.querySelector<HTMLElement>(
				"[data-testid='scroll-root']",
			);
			const virtualListRoot = container.querySelector<HTMLElement>(
				".twohop-page-virtual-list",
			);
			if (!scrollRoot || !virtualListRoot) {
				throw new Error("Expected TwoHop virtual-list elements.");
			}

			setNumericProperty(scrollRoot, "clientHeight", 120);
			setNumericProperty(scrollRoot, "scrollTop", 0);
			setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
			setElementRect(virtualListRoot, {
				top: 0,
				width: 330,
				height: 20_000,
			});
			triggerResize(virtualListRoot, 330, 20_000);
			triggerResize(scrollRoot, 330, 120);
			await flushFrames();
			await flushFrames();

			const shadowRoot = virtualListRoot.shadowRoot;
			const renderedItems =
				shadowRoot?.querySelectorAll("[data-testid='twohop-item-cell']")
					.length ?? 0;
			expect(shadowRoot).not.toBeNull();
			expect(
				shadowRoot?.querySelectorAll(".view-plan-virtual-list-cell").length,
			).toBeLessThanOrEqual(6);
			expect(renderedItems).toBeGreaterThan(0);
			expect(renderedItems).toBeLessThan(cardCount);
		},
	);

	it("rebuilds the retained surface when a resize changes column topology", async () => {
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
				renderChildComponent: true,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 20_000 });
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		const initialContent = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			".view-plan-virtual-list-content",
		);
		const initialChild = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(initialContent?.getAttribute("style")).toContain("--ccl-columns: 3");
		expect(initialChild).toBeTruthy();

		setElementRect(scrollRoot, { top: 0, width: 210, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 210, height: 20_000 });
		triggerResize(virtualListRoot, 210, 20_000);
		triggerResize(scrollRoot, 210, 120);
		await flushFrames();
		await flushFrames();

		const resizedContent = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			".view-plan-virtual-list-content",
		);
		const resizedChild = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(resizedContent?.getAttribute("style")).toContain("--ccl-columns: 2");
		expect(resizedContent).not.toBe(initialContent);
		expect(resizedChild).not.toBe(initialChild);
		expect(
			Array.from(
				virtualListRoot.shadowRoot?.querySelectorAll<HTMLElement>(
					"[data-ccl-row-slot]",
				) ?? [],
			).every((row) => row.querySelectorAll("[data-ccl-cell-slot]").length <= 2),
		).toBe(true);
	});

	it("updates retained geometry without scrolling when the column count is unchanged", async () => {
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
				renderChildComponent: true,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 20_000 });
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		const initialContent = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			".view-plan-virtual-list-content",
		);
		const initialChild = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(initialContent?.getAttribute("style")).toContain(
			"--ccl-box-height: 124px",
		);

		setElementRect(scrollRoot, { top: 0, width: 360, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 360, height: 20_000 });
		triggerResize(virtualListRoot, 360, 20_000);
		triggerResize(scrollRoot, 360, 120);
		await flushFrames();
		await flushFrames();

		const resizedContent = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			".view-plan-virtual-list-content",
		);
		const resizedChild = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='twohop-child-item-cell']",
		);
		expect(resizedContent).toBe(initialContent);
		expect(resizedChild).toBe(initialChild);
		expect(resizedContent?.getAttribute("style")).toContain(
			"--ccl-box-height: 136px",
		);
		for (const row of Array.from(
			virtualListRoot.shadowRoot?.querySelectorAll<HTMLElement>(
				"[data-ccl-row-slot]",
			) ?? [],
		)) {
			const rowIndex = Number(row.dataset.cclRowIndex);
			expect(row.style.transform).toBe(`translateY(${rowIndex * 146}px)`);
		}
	});

	it("does not create interaction descriptors while mounting visible cells", async () => {
		const getItemInteractionDescriptor = vi.fn(() => null);
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
				getItemInteractionDescriptor,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, {
			top: 0,
			width: 330,
			height: 20_000,
		});
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		expect(
			virtualListRoot.shadowRoot?.querySelectorAll(
				"[data-testid='twohop-item-cell']",
			).length,
		).toBeGreaterThan(0);
		expect(getItemInteractionDescriptor).not.toHaveBeenCalled();
	});

	it("keeps the last stable card layout while its tab is hidden", async () => {
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 20_000 });
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		const shadowRoot = virtualListRoot.shadowRoot;
		const content = shadowRoot?.querySelector<HTMLElement>(
			".view-plan-virtual-list-content",
		);
		const initialStyle = content?.getAttribute("style");
		const initialLogicalKeys = Array.from(
			shadowRoot?.querySelectorAll<HTMLElement>("[data-ccl-logical-key]") ?? [],
			(element) => element.dataset.cclLogicalKey,
		);
		expect(initialStyle).toContain("--ccl-columns: 3");
		expect(initialLogicalKeys.length).toBeGreaterThan(0);

		setNumericProperty(scrollRoot, "clientHeight", 0);
		setElementRect(scrollRoot, { top: 0, width: 0, height: 0 });
		setElementRect(virtualListRoot, { top: 0, width: 0, height: 0 });
		triggerResize(virtualListRoot, 0, 0);
		triggerResize(scrollRoot, 0, 0);
		await flushFrames();
		await flushFrames();

		expect(content?.getAttribute("style")).toBe(initialStyle);
		expect(
			Array.from(
				shadowRoot?.querySelectorAll<HTMLElement>("[data-ccl-logical-key]") ??
					[],
				(element) => element.dataset.cclLogicalKey,
			),
		).toEqual(initialLogicalKeys);

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 20_000 });
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		expect(content?.getAttribute("style")).toBe(initialStyle);
		expect(
			shadowRoot?.querySelectorAll("[data-testid='twohop-item-cell']").length,
		).toBeGreaterThan(0);
	});

	it("retains an item body when a recycled cell shell receives another logical item", async () => {
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}
		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 20_000 });
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();
		const shadowRoot = virtualListRoot.shadowRoot;
		const initialIndexes = new Set(
			Array.from(
				shadowRoot?.querySelectorAll<HTMLElement>(
					"[data-testid='twohop-item-cell']",
				) ?? [],
				(cell) => cell.dataset.index,
			),
		);
		const recycledItemElement = shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='1'] [data-testid='twohop-item-cell']",
		);
		const recycledItemIndex = recycledItemElement?.dataset.index;
		expect(recycledItemElement).toBeTruthy();

		setNumericProperty(scrollRoot, "scrollTop", 360);
		await fireEvent.scroll(scrollRoot);
		await flushFrames();
		await flushFrames();
		const nextIndexes = new Set(
			Array.from(
				virtualListRoot.shadowRoot?.querySelectorAll<HTMLElement>(
					"[data-testid='twohop-item-cell']",
				) ?? [],
				(cell) => cell.dataset.index,
			),
		);

		expect(nextIndexes).not.toEqual(initialIndexes);
		expect([...nextIndexes].some((index) => !initialIndexes.has(index))).toBe(true);
		const reboundItemElement = shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='1'] [data-testid='twohop-item-cell']",
		);
		expect(reboundItemElement).toBe(recycledItemElement);
		expect(reboundItemElement?.dataset.index).not.toBe(recycledItemIndex);
	});

	it("retains a child Svelte component for a different logical item", async () => {
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
				renderChildComponent: true,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 20_000 });
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		const shadowRoot = virtualListRoot.shadowRoot;
		const initialChild = shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='1'] [data-testid='twohop-child-item-cell']",
		);
		const initialIndex = initialChild?.dataset.index;
		const initialRowIndex = initialChild?.dataset.rowIndex;
		const initialRenderedKey = initialChild?.dataset.renderedKey;
		const initialInstanceId = initialChild?.dataset.instanceId;
		expect(initialChild).toBeTruthy();

		setNumericProperty(scrollRoot, "scrollTop", 360);
		await fireEvent.scroll(scrollRoot);
		await flushFrames();
		await flushFrames();

		const reboundChild = shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='1'] [data-testid='twohop-child-item-cell']",
		);
		expect(reboundChild).toBe(initialChild);
		expect(reboundChild?.dataset.instanceId).toBe(initialInstanceId);
		expect(reboundChild?.dataset.index).not.toBe(initialIndex);
		expect(reboundChild?.dataset.rowIndex).not.toBe(initialRowIndex);
		expect(reboundChild?.dataset.renderedKey).not.toBe(initialRenderedKey);
		expect(reboundChild?.dataset.renderedKey).toBe(
			`${reboundChild?.dataset.index}:${reboundChild?.dataset.rowIndex}`,
		);
	});

	it("publishes recycled row coordinates after a distant scroll jump", async () => {
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(10_000)],
				applicationStore,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, { top: 0, width: 330, height: 500_000 });
		triggerResize(virtualListRoot, 330, 500_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		setNumericProperty(scrollRoot, "scrollTop", 10_000);
		await fireEvent.scroll(scrollRoot);
		await flushFrames();
		await flushFrames();

		const rows = Array.from(
			virtualListRoot.shadowRoot?.querySelectorAll<HTMLElement>(
				"[data-ccl-row-slot]",
			) ?? [],
		);
		expect(rows).toHaveLength(4);
		expect(
			rows
				.map((row) => Number(row.dataset.cclRowIndex))
				.sort((left, right) => left - right),
		).toEqual([73, 74, 75, 76]);

		for (const row of rows) {
			const rowIndex = row.dataset.cclRowIndex;
			expect(rowIndex).toBeTruthy();
			expect(row.style.transform).toBe(`translateY(${Number(rowIndex) * 134}px)`);
			for (const cell of row.querySelectorAll<HTMLElement>(
				"[data-ccl-cell-slot]",
			)) {
				expect(cell.dataset.cclRowIndex).toBe(rowIndex);
			}
		}
	});

	it("keeps a resolved descriptor cached for a retained cell while scrolling", async () => {
		const getItemInteractionDescriptor = vi.fn(
			(item: TwoHopVirtualListItem): ItemInteractionDescriptor => ({
				interactionId: item.interactionId ?? "",
				kind: "item",
				item: item.item,
				targetFile: null,
			}),
		);
		const { container } = render(TwoHopViewPlanVirtualListPerfHarness, {
			props: {
				sections: [createDescriptor(100)],
				applicationStore,
				getItemInteractionDescriptor,
			},
		});
		const scrollRoot = container.querySelector<HTMLElement>(
			"[data-testid='scroll-root']",
		);
		const virtualListRoot = container.querySelector<HTMLElement>(
			".twohop-page-virtual-list",
		);
		if (!scrollRoot || !virtualListRoot) {
			throw new Error("Expected TwoHop virtual-list elements.");
		}

		setNumericProperty(scrollRoot, "clientHeight", 120);
		setNumericProperty(scrollRoot, "scrollTop", 0);
		setElementRect(scrollRoot, { top: 0, width: 330, height: 120 });
		setElementRect(virtualListRoot, {
			top: 0,
			width: 330,
			height: 20_000,
		});
		triggerResize(virtualListRoot, 330, 20_000);
		triggerResize(scrollRoot, 330, 120);
		await flushFrames();
		await flushFrames();

		const initialCards = Array.from(
			virtualListRoot.shadowRoot?.querySelectorAll<HTMLElement>(
				"[data-testid='twohop-item-cell']",
			) ?? [],
		);
		const retainedCard = initialCards.at(-1);
		const retainedIndex = retainedCard?.dataset.index;
		expect(retainedCard).toBeTruthy();
		expect(retainedIndex).toBeTruthy();
		if (!retainedCard || !retainedIndex) return;

		await fireEvent.click(retainedCard);
		expect(getItemInteractionDescriptor).toHaveBeenCalledTimes(1);

		setNumericProperty(scrollRoot, "scrollTop", 120);
		await fireEvent.scroll(scrollRoot);
		await flushFrames();
		await flushFrames();

		const cardAfterScroll = virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
			`[data-testid='twohop-item-cell'][data-index="${retainedIndex}"]`,
		);
		expect(cardAfterScroll).toBeTruthy();
		if (!cardAfterScroll) return;

		await fireEvent.click(cardAfterScroll);

		expect(getItemInteractionDescriptor).toHaveBeenCalledTimes(1);
	});
});
