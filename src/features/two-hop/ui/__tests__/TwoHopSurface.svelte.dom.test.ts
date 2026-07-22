import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import TwoHopSurface from "features/two-hop/ui/TwoHopSurface.svelte";
import TwoHopSurfaceModelHarness from "./TwoHopSurfaceModelHarness.svelte";
import {
	flushFrames,
	installAnimationFrameMock,
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownAnimationFrameMock,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";

beforeEach(() => {
	resetRecords();
	installResizeObserverMock();
	installIntersectionObserverMock();
	installAnimationFrameMock();
});

afterEach(() => {
	cleanup();
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
	teardownAnimationFrameMock();
});

function createSection(count: number): TwoHopVirtualSectionDescriptor {
	const items = Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	return {
		section: {
			kind: "new-links-section",
			rawSectionId: "section",
			sectionId: "section",
			sectionKey: "section",
			title: "Section",
			getKey: () => "",
		},
		sectionKey: "section",
		sectionId: "section",
		title: "Section",
		totalCount: count,
		loadedCount: count,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
}

const applicationStore = {
	settings: {
		...DEFAULT_SETTINGS,
		cardWidthPx: 100,
		cardHeightRatio: 1,
		cardMaxColumns: 3,
	},
} as unknown as ApplicationStore;

async function renderScrollableSurface(count: number): Promise<{
	root: HTMLElement;
	scroller: HTMLElement;
}> {
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientHeight", 120);
	setNumericProperty(scroller, "scrollHeight", 10_000);
	setNumericProperty(scroller, "scrollTop", 0);
	setElementRect(scroller, { top: 0, width: 330, height: 120 });
	document.body.append(scroller);

	render(TwoHopSurface, {
		target: scroller,
		props: {
			sections: [createSection(count)],
			applicationStore,
			initialVisibleCount: count,
		},
	});
	const root = scroller.querySelector<HTMLElement>(".twohop-keyed-surface");
	if (!root) {
		throw new Error("Two-hop virtual surface was not rendered");
	}

	setElementRect(root, { top: 0, width: 330, height: 10_000 });
	triggerResize(root, 330, 10_000);
	triggerResize(scroller, 330, 120);
	await flushFrames();

	return { root, scroller };
}

function getPhysicalSlot(root: HTMLElement, slot: number): HTMLElement | null {
	return (
		root.shadowRoot?.querySelector<HTMLElement>(`[data-ccl-cell-slot='${slot}']`) ??
		null
	);
}

async function scrollSurface(
	root: HTMLElement,
	scroller: HTMLElement,
	scrollTop: number,
): Promise<void> {
	setNumericProperty(scroller, "scrollTop", scrollTop);
	setElementRect(root, {
		top: -scrollTop,
		width: 330,
		height: 10_000,
	});
	await fireEvent.scroll(scroller);
	await flushFrames();
}

describe("TwoHopSurface", () => {
	it("shares each resolved card model with the rendered slot", () => {
		const resolveItemCardModel = vi.fn(
			(item: TwoHopVirtualListItem, presentation): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.virtualKey,
				ariaLabel: item.virtualKey,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.interactionId ?? item.virtualKey,
				interactionKey: item.interactionId ?? item.virtualKey,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				searchScope: "title-and-content",
				contentPreview: undefined,
				previewRefreshToken: 0,
				previewActivationIdentity: undefined,
				previewOverride: null,
				previewSnapshot: null,
			}),
		);
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
		const { container } = render(TwoHopSurfaceModelHarness, {
			props: {
				sections: [createSection(6)],
				applicationStore,
				linkContext,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(".twohop-keyed-surface");
		const renderedCards = root?.shadowRoot?.querySelectorAll(
			"[data-testid='twohop-item-cell']",
		).length;

		expect(renderedCards).toBeGreaterThan(0);
		expect(resolveItemCardModel).toHaveBeenCalledTimes(renderedCards ?? 0);
	});

	it.each([100, 1_000, 10_000])(
		"mounts %i logical cards with a bounded fixed pool",
		(cardCount) => {
			const { container } = render(TwoHopSurface, {
				props: {
					sections: [createSection(cardCount)],
					applicationStore,
					initialVisibleCount: 10_000,
				},
			});
			const root = container.querySelector<HTMLElement>(".twohop-keyed-surface");
			const cells = root?.shadowRoot?.querySelectorAll(
				".view-plan-virtual-list-cell",
			);

			expect(root?.shadowRoot).not.toBeNull();
			expect(cells?.length).toBeGreaterThan(0);
			expect(cells?.length).toBeLessThan(100);
			expect(
				root?.shadowRoot?.querySelectorAll("[data-testid='twohop-item-cell']")
					.length,
			).toBeGreaterThan(0);
		},
	);

	it.each([1, 8, 32])(
		"keeps %i surfaces on separate scrollers independently bounded",
		(count) => {
			const roots: HTMLElement[] = [];
			const scrollers: HTMLElement[] = [];
			for (let index = 0; index < count; index += 1) {
				const scroller = document.createElement("div");
				scroller.style.overflow = "auto";
				Object.defineProperty(scroller, "clientHeight", { value: 300 });
				Object.defineProperty(scroller, "scrollHeight", { value: 10_000 });
				document.body.append(scroller);
				scrollers.push(scroller);
				render(TwoHopSurface, {
					target: scroller,
					props: {
						sections: [createSection(100)],
						applicationStore,
						initialVisibleCount: 100,
					},
				});
				const root = scroller.querySelector<HTMLElement>(
					".twohop-keyed-surface",
				);
				if (root) roots.push(root);
			}

			expect(roots).toHaveLength(count);
			for (const root of roots) {
				expect(
					root.shadowRoot?.querySelectorAll(".view-plan-virtual-list-cell")
						.length,
				).toBeLessThan(100);
			}
			for (const scroller of scrollers) scroller.remove();
		},
	);

	it("updates pooled cells while scrolling an external observer root", async () => {
		const { root, scroller } = await renderScrollableSurface(100);
		const initialSlot = getPhysicalSlot(root, 1);
		const initialBody = initialSlot?.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);
		const initialKey = initialSlot?.dataset.cclLogicalKey;
		const initialRowIndex = initialSlot?.dataset.cclRowIndex;

		expect(initialBody?.textContent).toContain("item:0");
		expect(initialKey).toContain("item:0");
		if (!initialBody) {
			throw new Error("Initial item body was not rendered");
		}
		initialBody.tabIndex = 0;
		initialBody.dataset.cclHovered = "true";
		initialBody.dataset.cclLongPressed = "1";
		initialBody.focus();
		expect(root.shadowRoot?.activeElement).toBe(initialBody);

		await scrollSurface(root, scroller, 804);
		await waitFor(() => {
			expect(getPhysicalSlot(root, 1)?.dataset.cclLogicalKey).not.toBe(
				initialKey,
			);
		});

		const updatedSlot = getPhysicalSlot(root, 1);
		const updatedBody = updatedSlot?.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);
		expect(updatedBody).toBe(initialBody);
		expect(updatedBody?.textContent).not.toContain("item:0");
		expect(updatedSlot?.dataset.cclRowIndex).not.toBe(initialRowIndex);
		expect(root.shadowRoot?.activeElement).not.toBe(updatedBody);
		expect(updatedBody?.dataset.cclHovered).toBeUndefined();
		expect(updatedBody?.dataset.cclLongPressed).toBeUndefined();
	});

	it("remounts a load-more body as the newly revealed logical card", async () => {
		const { container } = render(TwoHopSurface, {
			props: {
				sections: [createSection(10)],
				applicationStore,
				initialVisibleCount: 1,
				loadMoreIncrement: 2,
			},
		});
		const root = container.querySelector<HTMLElement>(".twohop-keyed-surface");
		const loadMoreCell = root?.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='load-more-section']",
		);
		const loadMoreButton = loadMoreCell?.querySelector<HTMLButtonElement>(
			".cosense-card-links__load-more-button",
		);

		expect(loadMoreCell).not.toBeNull();
		expect(loadMoreButton).not.toBeNull();
		await fireEvent.click(loadMoreButton!);

		await waitFor(() => {
			expect(loadMoreCell?.dataset.testid).toBe("twohop-item-cell");
		});
		expect(
			loadMoreCell?.querySelector(".cosense-card-links__load-more-button"),
		).toBeNull();
		const itemBody = loadMoreCell?.querySelector(".cosense-card-links__box");
		expect(itemBody).not.toBe(loadMoreButton);
		expect(itemBody?.textContent).toContain("item:1");
	});
});
