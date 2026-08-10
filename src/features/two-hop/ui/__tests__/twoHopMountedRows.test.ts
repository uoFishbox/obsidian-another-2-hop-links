import { describe, expect, it, vi } from "vitest";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { buildMountedTwoHopRows } from "features/two-hop/ui/twoHopMountedRows";
import { createTwoHopRowModel } from "features/two-hop/ui/twoHopRowModel";
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
		documentIdentity: "test",
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

			expect(build.rowSlices).toHaveLength(9);
			expect(build.cells).toHaveLength(27);
			expect(build.poolCapacity).toBe(9);
			expect(new Set(build.cells.map((cell) => cell.renderSlotIndex)).size).toBe(
				27,
			);
			allocator.dispose();
		}
	});

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

		expect(build.rowSlices).toHaveLength(9);
		expect(getRow).toHaveBeenCalledTimes(100);
		allocator.dispose();
	});
});
