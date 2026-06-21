import { describe, expect, it } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import { logicalCellKey, sourceKey } from "../../types";
import type { FlatRow, SectionLayout } from "../../layout/viewPlanRowTypes";
import {
	canReuseMountedFlatCellContent,
	createMountedFlatCell,
	updateMountedFlatCell,
} from "../viewPlanMountedCells";

interface HarnessSection {
	key: string;
}

const descriptor: SectionRenderDescriptor<string, HarnessSection> = {
	section: { key: "section-0" },
	sectionKey: "section-0",
	title: "Section 0",
	sectionId: "section-0",
	totalCount: 1,
	loadedCount: 1,
	getItems: () => ["alpha"],
	headerProps: {},
};

const row: FlatRow<string, HarnessSection> = {
	sectionIndex: 0,
	key: 0,
	rowIndexInSection: 0,
	cellStartIndex: 0,
	rowCellCount: 1,
	top: 0,
	bottomSpacing: 10,
};

const section: SectionLayout<string, HarnessSection> = {
	descriptor,
	sectionIndex: 0,
	sectionId: descriptor.sectionId,
	visibleCount: 1,
	showLoadMore: false,
	cellCount: 2,
	rowCount: 1,
	contentHeight: 100,
	blockHeight: 110,
	sectionTop: 0,
};

const itemCell = {
	kind: "item" as const,
	key: logicalCellKey("item-0::item:0"),
	sourceKey: sourceKey("item-0"),
	item: "alpha",
	itemIndex: 0,
	itemRenderRevision: "r1",
};

function createMountedItem() {
	return createMountedFlatCell({
		key: itemCell.key,
		cell: itemCell,
		row,
		section,
		rowIndex: 0,
		columnIndex: 0,
		renderSlotIndex: 0,
		renderBodyKey: "body-0",
		renderBodyIdentity: {
			renderBodyKind: "item",
			renderBodySectionId: "section-0",
			renderBodySourceKey: "item-0",
			renderBodyRevision: "r1",
		},
	});
}

describe("viewPlanMountedCells", () => {
	it("creates mounted item cells with render body identity", () => {
		const mounted = createMountedItem();

		expect(mounted).toMatchObject({
			key: "item-0::item:0",
			renderSlotIndex: 0,
			renderSlotKey: 0,
			section: { key: "section-0" },
			sectionId: "section-0",
			renderBodyKey: "body-0",
		});
		expect(mounted.cellMetadataKey).toBeUndefined();
	});

	it("reuses compatible mounted item content and updates changed row layout", () => {
		const mounted = createMountedItem();
		expect(canReuseMountedFlatCellContent(mounted, itemCell, section)).toBe(
			true,
		);

		const updated = updateMountedFlatCell({
			previous: mounted,
			cell: itemCell,
			rowIndex: 1,
			columnIndex: 0,
			row: {
				...row,
				rowIndexInSection: 1,
				top: 130,
			},
			section,
			renderRevisionFallbackPolicy: "required",
		});

		expect(updated).not.toBe(mounted);
		expect(updated.rowTop).toBe(130);
		expect(updated.rowIndexInSection).toBe(1);
		expect(updated.renderBodyKey).toBe(mounted.renderBodyKey);
	});

	it("preserves mounted identity when layout and render body are unchanged", () => {
		const mounted = createMountedItem();

		const updated = updateMountedFlatCell({
			previous: mounted,
			cell: itemCell,
			rowIndex: 0,
			columnIndex: 0,
			row,
			section,
			renderRevisionFallbackPolicy: "required",
		});

		expect(updated).toBe(mounted);
	});

	it("does not reuse load-more content when the section object changes", () => {
		const cell = {
			kind: "load-more" as const,
			key: logicalCellKey("section-0::__load-more"),
		};
		const loadMoreSection = {
			...section,
			showLoadMore: true,
			cellCount: 3,
		};
		const mounted = createMountedFlatCell({
			key: cell.key,
			cell,
			row,
			section: loadMoreSection,
			rowIndex: 0,
			columnIndex: 0,
			renderSlotIndex: 0,
			renderBodyKey: "body-load-more",
			renderBodyIdentity: {
				renderBodyKind: "load-more",
				renderBodySectionId: "section-0",
				renderBodyCellKey: String(cell.key),
			},
		});
		const nextSection = {
			...loadMoreSection,
			descriptor: {
				...descriptor,
				section: { key: "section-1" },
			},
		};

		expect(
			canReuseMountedFlatCellContent(mounted, cell, nextSection),
		).toBe(false);
	});
});
