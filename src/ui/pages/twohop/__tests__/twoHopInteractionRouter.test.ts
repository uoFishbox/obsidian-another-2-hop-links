import { describe, expect, it } from "vitest";
import { createTwoHopInteractionRouter } from "../twoHopInteractionRouter";
import { createTwoHopGeometry } from "../twoHopGeometry";
import { createTwoHopSnapshot } from "../twoHopSnapshot";
import type { TwoHopVirtualSectionDescriptor } from "../twoHopVirtualListModel";
import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";

function createFixture() {
	const items = Array.from({ length: 3 }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	const descriptor = {
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
		totalCount: 3,
		loadedCount: 3,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	} satisfies TwoHopVirtualSectionDescriptor;
	const snapshot = createTwoHopSnapshot({
		sections: [descriptor],
		visibleCounts: { section: 3 },
		initialVisibleCount: 3,
	});
	const geometry = createTwoHopGeometry(snapshot, {
		containerWidth: 200,
		columns: 2,
		cellWidth: 95,
		rowHeight: 100,
		gap: 10,
		sectionMarginBottom: 20,
	});
	return { snapshot, geometry };
}

describe("twoHopInteractionRouter", () => {
	it("resolves horizontal and vertical targets from compact geometry", () => {
		const { snapshot, geometry } = createFixture();
		const router = createTwoHopInteractionRouter({
			getSnapshot: () => snapshot,
			getGeometry: () => geometry,
		});

		expect(
			router.resolveNavigationTarget("header:section", "right", {
				rowIndex: 0,
				columnIndex: 0,
			}),
		).toEqual({ key: "item:section:item:0", rowTop: 0 });
		expect(
			router.resolveNavigationTarget("item:section:item:0", "down", {
				rowIndex: 0,
				columnIndex: 1,
			}),
		).toEqual({ key: "item:section:item:2", rowTop: 110 });
	});
});
