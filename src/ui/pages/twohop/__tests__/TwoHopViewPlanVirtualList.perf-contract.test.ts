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
import TwoHopViewPlanVirtualListPerfHarness from "./TwoHopViewPlanVirtualListPerfHarness.svelte";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "../twohopPageVirtualModel";
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

const createItem = (index: number): TwoHopPageVirtualItem => ({
	kind: "new-link",
	item: { type: "link" } as unknown as TwoHopPageVirtualItem["item"],
	interactionId: `item:test:${index}`,
	searchKey: `item-${index}`,
	virtualKey: `item-${index}`,
});

const createDescriptor = (
	cardCount: number,
): SectionRenderDescriptor<TwoHopPageVirtualItem, TwoHopPageVirtualSection> => {
	const items = Array.from({ length: cardCount }, (_, index) =>
		createItem(index),
	);
	const section = {
		kind: "new-links-section",
		rawSectionId: "new-links",
		sectionId: "new-links",
		sectionKey: "new-links",
		title: "New links",
		getKey: () => "",
	} satisfies TwoHopPageVirtualSection;

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
			const { container } = render(
				TwoHopViewPlanVirtualListPerfHarness,
				{
					props: {
						sections: [createDescriptor(cardCount)],
						applicationStore,
					},
				},
			);
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
				shadowRoot?.querySelectorAll(
					"[data-testid='twohop-item-cell']",
				).length ?? 0;
			expect(shadowRoot).not.toBeNull();
			expect(
				shadowRoot?.querySelectorAll(".view-plan-virtual-list-cell")
					.length,
			).toBeLessThanOrEqual(6);
			expect(renderedItems).toBeGreaterThan(0);
			expect(renderedItems).toBeLessThan(cardCount);
		},
	);

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

	it("keeps a resolved descriptor cached for a retained cell while scrolling", async () => {
		const getItemInteractionDescriptor = vi.fn(
			(item: TwoHopPageVirtualItem): ItemInteractionDescriptor => ({
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

		const cardAfterScroll =
			virtualListRoot.shadowRoot?.querySelector<HTMLElement>(
				`[data-testid='twohop-item-cell'][data-index="${retainedIndex}"]`,
			);
		expect(cardAfterScroll).toBeTruthy();
		if (!cardAfterScroll) return;

		await fireEvent.click(cardAfterScroll);

		expect(getItemInteractionDescriptor).toHaveBeenCalledTimes(1);
	});
});
