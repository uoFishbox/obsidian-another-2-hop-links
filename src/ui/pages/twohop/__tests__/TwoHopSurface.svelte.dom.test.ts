import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "types/settings";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import TwoHopSurface from "../TwoHopSurface.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "../twoHopVirtualListModel";

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
				getItemInteractionDescriptor: () => null,
			},
		});
		const root = container.querySelector<HTMLElement>(
			".twohop-imperative-surface",
		);
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

	it.each([1, 8, 32])("keeps %i simultaneous surfaces independently bounded", (count) => {
		const roots: HTMLElement[] = [];
		for (let index = 0; index < count; index += 1) {
			const { container } = render(TwoHopSurface, {
				props: {
					sections: [createSection(100)],
					applicationStore,
					initialVisibleCount: 100,
					getItemInteractionDescriptor: () => null,
				},
			});
			const root = container.querySelector<HTMLElement>(
				".twohop-imperative-surface",
			);
			if (root) roots.push(root);
		}

		expect(roots).toHaveLength(count);
		for (const root of roots) {
			expect(
				root.shadowRoot?.querySelectorAll(".view-plan-virtual-list-cell").length,
			).toBeLessThan(100);
		}
	});
});
