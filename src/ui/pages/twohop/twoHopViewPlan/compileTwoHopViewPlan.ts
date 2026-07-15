import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { SectionLayout } from "ui/components/common/virtual-list/layout/viewPlanRowTypes";
import { getSectionPaginationKey } from "ui/components/common/virtual-list/pagination";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type {
	CompileTwoHopViewPlanParams,
	TwoHopSectionTable,
	TwoHopSectionPlan,
	PreparedTwoHopSection,
	TwoHopViewPlan,
} from "./types";
import { createTwoHopRowPlanFacade } from "./twoHopRowTable";
import { logicalCellKey, sourceKey } from "ui/components/common/virtual-list/types";
import {
	getViewPlanRenderBodyIdentityFields,
	resolveStableViewPlanRenderBodyKey,
} from "ui/components/common/virtual-list/core/reconciliation/renderBodyRevision";
import type { CompiledTwoHopCell } from "./types";
import { compileTwoHopCellDisplayMetadata } from "../twoHopCellDisplayMetadata";
/**
 * Compiles TwoHop data into section prefix metadata consumed while scrolling.
 */
export function compileTwoHopViewPlan(
	params: CompileTwoHopViewPlanParams,
): TwoHopViewPlan {
	const sections: TwoHopSectionPlan[] = [];
	const columns = Math.max(1, Math.floor(params.layout.columns));
	const rowHeight = Math.max(0, params.layout.rowHeight);
	const gap = Math.max(0, params.layout.gap);
	const sectionMarginBottom = Math.max(0, params.layout.sectionMarginBottom);
	const sectionCount = params.sections.length;
	const topBySection = new Float64Array(sectionCount);
	const heightBySection = new Float64Array(sectionCount);
	const firstRowIndexBySection = new Uint32Array(sectionCount);
	const rowCountBySection = new Uint32Array(sectionCount);
	const firstCellIndexBySection = new Uint32Array(sectionCount);
	const cellCountBySection = new Uint32Array(sectionCount);
	const visibleCountBySection = new Uint32Array(sectionCount);
	const showLoadMoreBySection = new Uint8Array(sectionCount);
	const preparedItemsBySection: (readonly TwoHopVirtualListItem[])[] = [];
	let totalRowCount = 0;
	let totalCellCount = 0;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const descriptor = params.sections[sectionIndex];
		// Descriptor access may sort/reconcile. Resolve it while compiling the
		// data snapshot so the scroll path only performs O(1)
		// prepared array reads.
		const preparedItems = descriptor.getItems();
		preparedItemsBySection.push(preparedItems);
		const paginationKey = getSectionPaginationKey(descriptor);
		const visibleCount = params.clampVisibleCount(
			descriptor,
			params.sectionVisibleCounts[paginationKey] ??
				params.resolveInitialSectionVisibleCount(descriptor),
		);
		let visibleItemCount = 0;
		for (let itemIndex = 0; itemIndex < visibleCount; itemIndex += 1) {
			if (preparedItems[itemIndex]) visibleItemCount += 1;
		}
		const showLoadMore = visibleCount < descriptor.loadedCount;
		const cellCount = 1 + visibleItemCount + (showLoadMore ? 1 : 0);
		const rowCount = Math.ceil(cellCount / columns);
		visibleCountBySection[sectionIndex] = visibleCount;
		cellCountBySection[sectionIndex] = cellCount;
		rowCountBySection[sectionIndex] = rowCount;
		showLoadMoreBySection[sectionIndex] = showLoadMore ? 1 : 0;
		totalCellCount += cellCount;
		totalRowCount += rowCount;
	}
	const rowSectionIndex = new Uint32Array(totalRowCount);
	const rowFirstCellIndex = new Uint32Array(totalRowCount);
	const rowCellCount = new Uint8Array(totalRowCount);
	const rowTop = new Float64Array(totalRowCount);
	const cells: CompiledTwoHopCell[] = [];

	let top = 0;
	let nextCellIndex = 0;
	let nextRowIndex = 0;
	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const descriptor = params.sections[sectionIndex];
		const visibleCount = visibleCountBySection[sectionIndex];
		const cellCount = cellCountBySection[sectionIndex];
		const rowCount = rowCountBySection[sectionIndex];
		const showLoadMore = showLoadMoreBySection[sectionIndex] !== 0;
		const preparedItems = preparedItemsBySection[sectionIndex] ?? [];
		const sectionIdPrefix = `${descriptor.sectionId}::`;
		const preparedCells: VirtualListLogicalCell<TwoHopVirtualListItem>[] = [
			{
				kind: "header",
				key: logicalCellKey(`${sectionIdPrefix}__header`),
			},
		];
		for (let itemIndex = 0; itemIndex < visibleCount; itemIndex += 1) {
			const item = preparedItems[itemIndex];
			if (!item) continue;
			preparedCells.push({
				kind: "item",
				key: logicalCellKey(`${sectionIdPrefix}item:${itemIndex}`),
				sourceKey: sourceKey(`${sectionIdPrefix}${item.virtualKey}`),
				item,
				itemIndex,
			});
		}
		if (showLoadMore) {
			preparedCells.push({
				kind: "load-more",
				key: logicalCellKey(`${sectionIdPrefix}__load-more`),
			});
		}
		for (const logicalCell of preparedCells) {
			const identity = getViewPlanRenderBodyIdentityFields(
				logicalCell,
				descriptor,
			);
			const displayMetadata = compileTwoHopCellDisplayMetadata(
				logicalCell,
				descriptor.section,
			);
			cells.push({
				logicalCell,
				logicalKey: logicalCell.key,
				renderBodyKey: resolveStableViewPlanRenderBodyKey({
					previous: undefined,
					cell: logicalCell,
					descriptor,
				}),
				renderBodyKind: identity.renderBodyKind,
				renderBodySectionId: identity.renderBodySectionId,
				renderBodySourceKey: identity.renderBodySourceKey,
				renderBodyCellKey: identity.renderBodyCellKey,
				renderBodyRevision: identity.renderBodyRevision,
				...displayMetadata,
			});
		}
		const itemSource: PreparedTwoHopSection = {
			id: descriptor.sectionId,
			itemCount: preparedItems.length,
			readItem: (index) => preparedItems[index],
			readCell: (index) => preparedCells[index],
		};
		const firstCellIndex = nextCellIndex;
		nextCellIndex += cellCount;

		const firstRowIndex = nextRowIndex;
		nextRowIndex += rowCount;
		const contentHeight =
			rowCount > 0 ? rowCount * rowHeight + (rowCount - 1) * gap : 0;
		const height = contentHeight + sectionMarginBottom;
		topBySection[sectionIndex] = top;
		heightBySection[sectionIndex] = height;
		firstRowIndexBySection[sectionIndex] = firstRowIndex;
		firstCellIndexBySection[sectionIndex] = firstCellIndex;
		for (
			let rowIndexInSection = 0;
			rowIndexInSection < rowCount;
			rowIndexInSection += 1
		) {
			const rowIndex = firstRowIndex + rowIndexInSection;
			const sectionCellStartIndex = rowIndexInSection * columns;
			rowSectionIndex[rowIndex] = sectionIndex;
			rowFirstCellIndex[rowIndex] = firstCellIndex + sectionCellStartIndex;
			rowCellCount[rowIndex] = Math.min(
				columns,
				cellCount - sectionCellStartIndex,
			);
			rowTop[rowIndex] = top + rowIndexInSection * (rowHeight + gap);
		}

		const mountedLayout: SectionLayout<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		> = {
			descriptor,
			sectionIndex,
			sectionId: descriptor.sectionId,
			visibleCount,
			showLoadMore,
			cellCount,
			rowCount,
			contentHeight,
			blockHeight: height,
			sectionTop: top,
		};
		sections.push({
			descriptor,
			sectionIndex,
			sectionId: descriptor.sectionId,
			sectionIdPrefix,
			top,
			height,
			firstRowIndex,
			rowCount,
			firstCellIndex,
			cellCount,
			visibleCount,
			showLoadMore,
			itemSource,
			mountedLayout,
		});
		top += height;
	}

	const sectionTable: TwoHopSectionTable = {
		sectionCount,
		topBySection,
		heightBySection,
		firstRowIndexBySection,
		rowCountBySection,
		firstCellIndexBySection,
		cellCountBySection,
		visibleCountBySection,
		showLoadMoreBySection,
	};
	const geometry = {
		sectionTable,
		rowCount: totalRowCount,
		columns,
		rowHeight,
		rowGap: gap,
		rowSectionIndex,
		rowFirstCellIndex,
		rowCellCount,
		rowTop,
	};
	const plan: TwoHopViewPlan = {
		sections,
		cells,
		rows: createTwoHopRowPlanFacade(geometry),
		sectionTable,
		rowSectionIndex,
		rowFirstCellIndex,
		rowCellCount,
		rowTop,
		rowCount: totalRowCount,
		cellCount: totalCellCount,
		columns,
		rowHeight,
		rowGap: gap,
		totalHeight: top,
		layout: params.layout,
	};
	return plan;
}
