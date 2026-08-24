import { describe, expect, it, vi } from "vitest";
import { createResidentRowSlotAllocator } from "ui/virtualization/public";
import { buildMountedTwoHopRows } from "../mountedRows";
import { createTwoHopRowModel } from "../rowModel";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
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
	it("reads one section per entering row with 1,000 sections", () => {
		const source = Array.from({ length: 1_000 }, (_, sectionIndex) =>
			createTwoHopSectionModel({
				id: `section:${sectionIndex}`,
				kind: "new-links-section",
				title: `Section ${sectionIndex}`,
				items: Array.from({ length: 9 }, (_, itemIndex) => ({
					item: { type: "newLink" },
					searchKey: `item:${sectionIndex}:${itemIndex}`,
					key: `item:${sectionIndex}:${itemIndex}`,
				})) as TwoHopItemModel[],
				totalCount: 9,
			}),
		);
		let sectionReads = 0;
		const sections: readonly TwoHopSectionModel[] = new Proxy(source, {
			get(target, property, receiver) {
				if (typeof property === "string" && /^\d+$/.test(property)) {
					sectionReads += 1;
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const model = createTwoHopRowModel({
			sections,
			layout: {
				containerWidth: 320,
				columns: 3,
				cellWidth: 100,
				rowHeight: 100,
				gap: 10,
				sectionMarginBottom: 20,
			},
		});
		const allocator = createResidentRowSlotAllocator();
		sectionReads = 0;

		const build = buildMountedTwoHopRows({
			rowModel: model,
			rowRange: { start: 2_000, end: 2_009 },
			rowSlotAllocator: allocator,
		});

		expect(build.rowsInMountedRange).toHaveLength(9);
		expect(sectionReads).toBe(9);
		allocator.dispose();
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

		expect(build.rowsInMountedRange).toHaveLength(9);
		expect(getRow).toHaveBeenCalledTimes(100);
		allocator.dispose();
	});
});
