import { describe, expect, it, vi } from "vitest";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionProjection } from "features/two-hop/ui/twoHopSectionProjection";

function createSection(count: number) {
	return createTwoHopSectionModel({
		id: "section",
		kind: "new-links-section",
		title: "Section",
		items: Array.from({ length: count }, (_, index) => ({
			item: { type: "newLink" },
			searchKey: `item-${index}`,
			key: `item-${index}`,
		})) as TwoHopItemModel[],
	});
}

describe("two-hop section projection", () => {
	it("applies and expands visible counts without wrapping item access", () => {
		const source = createSection(5);
		const projection = createTwoHopSectionProjection({
			sections: [source],
			initialVisibleCount: 2,
			loadMoreIncrement: 2,
		});

		expect(projection.getSections()[0]?.items).toBe(source.items);
		expect(projection.getSections()[0]?.visibleCount).toBe(2);
		expect(projection.loadMore("section")?.[0]?.visibleCount).toBe(4);
		expect(projection.loadMore("section")?.[0]?.visibleCount).toBe(5);
		expect(projection.loadMore("section")).toBeNull();
	});

	it("stores expansion under the scoped section id", () => {
		const setSectionExpandedLimit = vi.fn();
		const projection = createTwoHopSectionProjection({
			sections: [createSection(5)],
			applicationStore: { setSectionExpandedLimit },
			initialVisibleCount: 1,
			loadMoreIncrement: 1,
			paginationScope: "query",
		});

		projection.loadMore("section");
		expect(setSectionExpandedLimit).toHaveBeenCalledWith(
			expect.stringMatching(/^s:/),
			2,
		);
	});
});
