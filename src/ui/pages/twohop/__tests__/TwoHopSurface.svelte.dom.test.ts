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
	it("mounts one imperative shadow surface with a bounded fixed pool", () => {
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
		const { container } = render(TwoHopSurface, {
			props: {
				sections: [createSection(10_000)],
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
	});
});
