import { describe, expect, it } from "vitest";
import { createTwoHopInteractionRouter } from "features/two-hop/ui/twoHopInteractionRouter";
import { compileFixedGridLayout } from "features/two-hop/ui/viewport/twoHopGeometry";
import { createTwoHopDocument } from "features/two-hop/ui/twoHopDocument";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";

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
	const document = createTwoHopDocument({
		sections: [descriptor],
		visibleCounts: { section: 3 },
		initialVisibleCount: 3,
	});
	const geometry = compileFixedGridLayout(document, {
		containerWidth: 200,
		columns: 2,
		cellWidth: 95,
		rowHeight: 100,
		gap: 10,
		sectionMarginBottom: 20,
	});
	return { document, geometry };
}

describe("twoHopInteractionRouter", () => {
	it("resolves horizontal and vertical targets from compact geometry", () => {
		const { document, geometry } = createFixture();
		const router = createTwoHopInteractionRouter({
			getDocument: () => document,
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
