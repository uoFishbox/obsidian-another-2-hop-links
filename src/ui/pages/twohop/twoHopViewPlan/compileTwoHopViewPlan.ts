import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { SectionLayout } from "ui/components/common/virtual-list/layout/viewPlanRowTypes";
import { getSectionPaginationKey } from "ui/components/common/virtual-list/pagination";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "../twohopPageVirtualModel";
import type {
	CompileTwoHopViewPlanParams,
	TwoHopCellStore,
	TwoHopRowTable,
	TwoHopSectionPlan,
	TwoHopViewPlan,
} from "./types";
import { createTwoHopCellStore } from "./twoHopCellStore";
import { createTwoHopRowPlanFacade } from "./twoHopRowTable";
import {
	materializeNextTwoHopCellBatch,
	materializeTwoHopSectionCells,
	resolveInitialMaterializationCellCount,
} from "./twoHopMaterialization";
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
	const visibleCounts = new Uint32Array(sectionCount);
	const cellCounts = new Uint32Array(sectionCount);
	const rowCounts = new Uint32Array(sectionCount);
	const showLoadMoreBySection = new Uint8Array(sectionCount);
	const eagerItemsBySection: (readonly TwoHopPageVirtualItem[] | undefined)[] = [];
	const batchedMaterialization = params.materialization?.kind === "batched";
	let totalRowCount = 0;
	let totalCellCount = 0;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const descriptor = params.sections[sectionIndex];
		const paginationKey = getSectionPaginationKey(descriptor);
		const visibleCount = params.clampVisibleCount(
			descriptor,
			params.sectionVisibleCounts[paginationKey] ??
				params.resolveInitialSectionVisibleCount(descriptor),
		);
		let visibleItemCount = visibleCount;
		if (!batchedMaterialization) {
			const items = descriptor.getItems();
			eagerItemsBySection.push(items);
			visibleItemCount = 0;
			for (let itemIndex = 0; itemIndex < visibleCount; itemIndex += 1) {
				if (items[itemIndex]) visibleItemCount += 1;
			}
		} else {
			eagerItemsBySection.push(undefined);
		}
		const showLoadMore = visibleCount < descriptor.loadedCount;
		const cellCount = 1 + visibleItemCount + (showLoadMore ? 1 : 0);
		const rowCount = Math.ceil(cellCount / columns);
		visibleCounts[sectionIndex] = visibleCount;
		cellCounts[sectionIndex] = cellCount;
		rowCounts[sectionIndex] = rowCount;
		showLoadMoreBySection[sectionIndex] = showLoadMore ? 1 : 0;
		totalCellCount += cellCount;
		totalRowCount += rowCount;
	}

	let top = 0;
	let nextCellIndex = 0;
	let nextRowIndex = 0;
	const sectionIndexByRow = new Int32Array(totalRowCount);
	const rowIndexInSectionByRow = new Int32Array(totalRowCount);
	const sectionCellStartByRow = new Int32Array(totalRowCount);
	const cellCountByRow = new Uint16Array(totalRowCount);
	const topByRow = new Float64Array(totalRowCount);
	const logicalCellsBySectionIndex: TwoHopCellStore["logicalCellsBySectionIndex"] =
		[];
	const rowStride = rowHeight + gap;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const descriptor = params.sections[sectionIndex];
		const visibleCount = visibleCounts[sectionIndex];
		const cellCount = cellCounts[sectionIndex];
		const rowCount = rowCounts[sectionIndex];
		const showLoadMore = showLoadMoreBySection[sectionIndex] !== 0;
		const firstCellIndex = nextCellIndex;
		nextCellIndex += cellCount;

		const firstRowIndex = nextRowIndex;
		nextRowIndex += rowCount;
		const contentHeight =
			rowCount > 0 ? rowCount * rowHeight + (rowCount - 1) * gap : 0;
		const height = contentHeight + sectionMarginBottom;

		for (
			let rowIndexInSection = 0;
			rowIndexInSection < rowCount;
			rowIndexInSection += 1
		) {
			const sectionCellStartIndex = rowIndexInSection * columns;
			const writeIndex = firstRowIndex + rowIndexInSection;
			sectionIndexByRow[writeIndex] = sectionIndex;
			rowIndexInSectionByRow[writeIndex] = rowIndexInSection;
			sectionCellStartByRow[writeIndex] = sectionCellStartIndex;
			cellCountByRow[writeIndex] = Math.min(
				columns,
				cellCount - sectionCellStartIndex,
			);
			topByRow[writeIndex] = top + rowIndexInSection * rowStride;
		}
		const mountedLayout: SectionLayout<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
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
		logicalCellsBySectionIndex[sectionIndex] = new Array<
			VirtualListLogicalCell<TwoHopPageVirtualItem> | undefined
		>(cellCount);
		sections.push({
			descriptor,
			sectionIndex,
			sectionId: descriptor.sectionId,
			sectionIdPrefix: `${descriptor.sectionId}::`,
			top,
			height,
			firstRowIndex,
			rowCount,
			firstCellIndex,
			cellCount,
			visibleCount,
			showLoadMore,
			mountedLayout,
		});
		top += height;
	}

	const cellStore = createTwoHopCellStore(
		logicalCellsBySectionIndex,
		sections.length,
		totalCellCount,
	);
	const rowTable: TwoHopRowTable = {
		rowCount: totalRowCount,
		sectionIndexByRow,
		rowIndexInSectionByRow,
		sectionCellStartByRow,
		cellCountByRow,
		topByRow,
	};
	const plan: TwoHopViewPlan = {
		sections,
		rows: createTwoHopRowPlanFacade(rowTable),
		rowTable,
		rowCount: totalRowCount,
		cellCount: totalCellCount,
		columns,
		rowHeight,
		rowGap: gap,
		totalHeight: top,
		layout: params.layout,
		cellStore,
	};
	if (params.materialization?.kind === "batched") {
		const initialCellCount = Math.min(
			Math.max(0, Math.floor(params.materialization.initial.maxCellCount)),
			resolveInitialMaterializationCellCount(
				plan,
				params.materialization.initial.maxSectionCount,
			),
		);
		materializeNextTwoHopCellBatch(plan, {
			maxCellCount: initialCellCount,
		});
	} else {
		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
			materializeTwoHopSectionCells(
				plan,
				sectionIndex,
				eagerItemsBySection[sectionIndex],
			);
		}
	}
	return plan;
}
