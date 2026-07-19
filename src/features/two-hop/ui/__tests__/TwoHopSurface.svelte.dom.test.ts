import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import TwoHopSurface from "features/two-hop/ui/TwoHopSurface.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";

afterEach(cleanup);

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

describe("TwoHopSurface", () => {
	const applicationStore = {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 100,
			cardHeightRatio: 1,
			cardMaxColumns: 3,
		},
	} as unknown as ApplicationStore;

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
		expect(loadMoreCell?.textContent).toContain("item:1");
	});
});
