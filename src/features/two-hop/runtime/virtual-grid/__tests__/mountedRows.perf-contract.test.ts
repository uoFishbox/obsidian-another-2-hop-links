import { describe, expect, it, vi } from "vitest";
import { createResidentRowSlotAllocator } from "ui/virtualization/public";
import { buildMountedTwoHopRows } from "../mountedRows";
import { createTwoHopRowModel } from "../rowModel";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "features/two-hop/ui/twoHopSectionModel";

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

describe("buildMountedTwoHopRows performance contracts", () => {
	it("resolves only the entering row during sustained scrolling", () => {
		const model = createModel(10_000);
		const allocator = createResidentRowSlotAllocator();
		let build = buildMountedTwoHopRows({
			rowModel: model,
			rowRange: { start: 10, end: 19 },
			rowSlotAllocator: allocator,
		});
		const getRow = vi.spyOn(model, "getRow");

		for (let frame = 1; frame <= 100; frame += 1) {
			build = buildMountedTwoHopRows({
				rowModel: model,
				rowRange: { start: 10 + frame, end: 19 + frame },
				rowSlotAllocator: allocator,
				previousBuild: build,
			});
		}

		expect(build.rowsInMountedRange).toHaveLength(9);
		expect(getRow).toHaveBeenCalledTimes(100);
		allocator.dispose();
	});
});
