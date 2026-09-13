import { describe, expect, it, vi } from "vitest";
import {
	computeFlatGridLayout,
	createResidentRowSlotAllocator,
} from "cards/virtualization/public";
import { createFlatGridCellSource } from "../cellSource";
import { createFlatGridCardBindingsMemo } from "../mountedCardBindings";
import { buildMountedFlatGridRows } from "../mountedRows";
import { createFlatGridRowModel } from "../rowModel";

interface TestItem {
	readonly id: string;
}

const PREVIEW_CARD_DIMENSIONS = { widthPx: 100, heightPx: 120 } as const;

function createMountedBuild(items: readonly TestItem[]) {
	const cellSource = createFlatGridCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "bindings-memo",
	});
	const layout = computeFlatGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 120,
		cellCount: cellSource.cellCount,
	});
	const rowModel = createFlatGridRowModel({ cellSource, layout });

	return buildMountedFlatGridRows({
		rowModel,
		rowRange: { start: 0, end: rowModel.rowCount },
		rowSlotAllocator: createResidentRowSlotAllocator(),
	});
}

describe("createFlatGridCardBindingsMemo", () => {
	it("does not rerun resolvers while only preview visibility changes", () => {
		const mountedBuild = createMountedBuild([
			{ id: "item-0" },
			{ id: "item-1" },
			{ id: "item-2" },
		]);
		const resolvePreviewRequest = vi.fn(() => null);
		const resolveBindings = createFlatGridCardBindingsMemo<TestItem>();

		const first = resolveBindings({
			mountedBuild,
			previewCardDimensions: PREVIEW_CARD_DIMENSIONS,
			resolvePreviewRequest,
		});
		const previewOnlyUpdate = resolveBindings({
			mountedBuild,
			previewCardDimensions: PREVIEW_CARD_DIMENSIONS,
			resolvePreviewRequest,
		});

		expect(previewOnlyUpdate).toBe(first);
		expect(resolvePreviewRequest).toHaveBeenCalledTimes(3);
	});

	it("rebuilds when a resolver identity or mounted build changes", () => {
		const mountedBuild = createMountedBuild([{ id: "item-0" }]);
		const nextMountedBuild = { ...mountedBuild };
		const firstPreviewResolver = vi.fn(() => null);
		const nextPreviewResolver = vi.fn(() => null);
		const resolveBindings = createFlatGridCardBindingsMemo<TestItem>();

		const initial = resolveBindings({
			mountedBuild,
			previewCardDimensions: PREVIEW_CARD_DIMENSIONS,
			resolvePreviewRequest: firstPreviewResolver,
		});
		const resolverUpdate = resolveBindings({
			mountedBuild,
			previewCardDimensions: PREVIEW_CARD_DIMENSIONS,
			resolvePreviewRequest: nextPreviewResolver,
		});
		const buildUpdate = resolveBindings({
			mountedBuild: nextMountedBuild,
			previewCardDimensions: PREVIEW_CARD_DIMENSIONS,
			resolvePreviewRequest: nextPreviewResolver,
		});

		expect(resolverUpdate).not.toBe(buildUpdate);
		expect(resolverUpdate).not.toBe(initial);
		expect(firstPreviewResolver).toHaveBeenCalledTimes(1);
		expect(nextPreviewResolver).toHaveBeenCalledTimes(2);
	});

	it("rebuilds bindings when resolved card dimensions change", () => {
		const mountedBuild = createMountedBuild([{ id: "item-0" }]);
		const resolvePreviewRequest = vi.fn(() => null);
		const resolveBindings = createFlatGridCardBindingsMemo<TestItem>();

		const initial = resolveBindings({
			mountedBuild,
			previewCardDimensions: PREVIEW_CARD_DIMENSIONS,
			resolvePreviewRequest,
		});
		const resized = resolveBindings({
			mountedBuild,
			previewCardDimensions: { widthPx: 150, heightPx: 180 },
			resolvePreviewRequest,
		});

		expect(resized).not.toBe(initial);
		expect(resolvePreviewRequest).toHaveBeenCalledTimes(2);
	});
});
