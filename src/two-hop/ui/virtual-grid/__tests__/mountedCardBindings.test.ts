import { describe, expect, it, vi } from "vitest";
import { createResidentRowSlotAllocator } from "cards/virtualization/public";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";
import { createTwoHopPreviewBindingsMemo } from "../mountedCardBindings";
import { buildMountedTwoHopRows } from "../mountedRows";
import { createTwoHopRowModel } from "../rowModel";

function createMountedBuild() {
	const items = Array.from({ length: 3 }, (_, index) => ({
		item: { type: "newLink" },
		searchKey: `item:${index}`,
		key: `item:${index}`,
	})) as TwoHopItemModel[];
	const rowModel = createTwoHopRowModel({
		sections: [
			createTwoHopSectionModel({
				id: "section",
				kind: "new-links-section",
				title: "Section",
				items,
				totalCount: items.length,
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

	return buildMountedTwoHopRows({
		rowModel,
		rowRange: { start: 0, end: rowModel.rowCount },
		rowSlotAllocator: createResidentRowSlotAllocator(),
	});
}

describe("createTwoHopPreviewBindingsMemo", () => {
	it("reuses bindings when only preview visibility changes", () => {
		const mountedBuild = createMountedBuild();
		const getCardModel = vi.fn(() => undefined);
		const resolveBindings = createTwoHopPreviewBindingsMemo();
		const params = {
			mountedBuild,
			modelRevision: 0,
			widthPx: 100,
			heightPx: 120,
			active: true,
			getCardModel,
		};

		const first = resolveBindings(params);
		const visibilityOnlyUpdate = resolveBindings(params);

		expect(visibilityOnlyUpdate).toBe(first);
		expect(getCardModel).toHaveBeenCalledTimes(3);
	});

	it("rebuilds after hydration, resize, mounted-window, and active-state changes", () => {
		const mountedBuild = createMountedBuild();
		const getCardModel = vi.fn(() => undefined);
		const resolveBindings = createTwoHopPreviewBindingsMemo();
		const base = {
			mountedBuild,
			modelRevision: 0,
			widthPx: 100,
			heightPx: 120,
			active: true,
			getCardModel,
		};

		const initial = resolveBindings(base);
		const hydrated = resolveBindings({ ...base, modelRevision: 1 });
		const resized = resolveBindings({ ...base, modelRevision: 1, widthPx: 140 });
		const movedBuild = { ...mountedBuild };
		const moved = resolveBindings({
			...base,
			modelRevision: 1,
			widthPx: 140,
			mountedBuild: movedBuild,
		});
		const inactive = resolveBindings({
			...base,
			modelRevision: 1,
			widthPx: 140,
			mountedBuild: movedBuild,
			active: false,
		});

		expect(hydrated).not.toBe(initial);
		expect(resized).not.toBe(hydrated);
		expect(moved).not.toBe(resized);
		expect(inactive).toHaveLength(0);
		expect(getCardModel).toHaveBeenCalledTimes(12);
	});
});
