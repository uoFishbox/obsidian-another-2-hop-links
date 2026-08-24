import { describe, expect, it } from "vitest";
import { createResidentRowSlotAllocator } from "cards/virtualization/public";
import { buildMountedTwoHopRows } from "../rowModel";
import { createTwoHopRowModel } from "../rowModel";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";

function createModel(itemCount: number) {
	const items = Array.from({ length: itemCount }, (_, index) => ({
		item: { type: "newLink" },
		searchKey: `item:${index}`,
		key: `item:${index}`,
	})) as TwoHopItemModel[];
	return createTwoHopRowModel({
		sections: [
			createTwoHopSectionModel({
				id: "section",
				kind: "new-links-section",
				title: "Section",
				items,
				totalCount: itemCount,
			}),
		],
		layout: {
			containerWidth: 320,
			columns: 3,
			cellWidth: 100,
			rowHeight: 100,
			gap: 10,
			sectionMarginBottom: 10,
		},
	});
}

describe("buildMountedTwoHopRows", () => {
	it("bounds resident rows and cells independently of total item count", () => {
		for (const itemCount of [100, 1_000, 10_000]) {
			const model = createModel(itemCount);
			const allocator = createResidentRowSlotAllocator();
			const build = buildMountedTwoHopRows({
				rowModel: model,
				rowRange: { start: 10, end: 19 },
				rowSlotAllocator: allocator,
			});

			expect(build.rowsInMountedRange).toHaveLength(9);
			expect(build.cells).toHaveLength(27);
			expect(build.poolCapacity).toBe(9);
			expect(new Set(build.cells.map((cell) => cell.physicalCellSlot)).size).toBe(
				27,
			);
			allocator.dispose();
		}
	});
});
