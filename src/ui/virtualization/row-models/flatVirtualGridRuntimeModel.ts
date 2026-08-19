import {
	createFlatLogicalCellSource,
	type FlatLogicalCellSource,
} from "../flatLogicalCellSource";
import type { FlatGridLayoutMetrics } from "../layoutMetrics";
import { createFlatLinkRowModel, type FlatLinkRowModel } from "./flatLinkRowModel";

/**
 * Keeps one logical source and row model per list instance while their actual
 * inputs stay unchanged. In-place item mutations still require itemsRevision.
 */
export function createFlatVirtualGridRuntimeModel<T>() {
	let hasBindingTopology = false;
	let bindingDataRevision: unknown;
	let bindingKeyRevision: unknown;
	let bindingHasHeader = false;
	let bindingSectionId: string | undefined;
	let bindingTopologyRevision: unknown;

	let logicalCellSource: FlatLogicalCellSource<T> | null = null;
	let contentDataRevision: unknown;
	let contentKeyRevision: unknown;
	let contentVisibleCount = -1;
	let contentHasHeader = false;
	let contentShowLoadMore = false;
	let contentSectionId: string | undefined;

	let rowModel: FlatLinkRowModel<T> | null = null;
	let rowModelCellSourceRevision: unknown;
	let rowModelColumns = -1;
	let rowModelCellWidth = -1;
	let rowModelRowHeight = -1;
	let rowModelGap = -1;
	let rowModelRowCount = -1;

	return {
		resolveLogicalCellSource(params: {
			items: readonly T[];
			getItemId: (item: T, index: number) => string;
			itemsRevision?: unknown;
			itemIdRevision?: unknown;
			visibleCount: number;
			hasHeader: boolean;
			showLoadMore: boolean;
			sectionId?: string;
		}): FlatLogicalCellSource<T> {
			const dataRevision = params.itemsRevision ?? params.items;
			const keyRevision = params.itemIdRevision ?? params.getItemId;
			if (
				!hasBindingTopology ||
				!Object.is(bindingDataRevision, dataRevision) ||
				!Object.is(bindingKeyRevision, keyRevision) ||
				bindingHasHeader !== params.hasHeader ||
				bindingSectionId !== params.sectionId
			) {
				hasBindingTopology = true;
				bindingDataRevision = dataRevision;
				bindingKeyRevision = keyRevision;
				bindingHasHeader = params.hasHeader;
				bindingSectionId = params.sectionId;
				bindingTopologyRevision = {
					data: dataRevision,
					key: keyRevision,
					hasHeader: params.hasHeader,
					sectionId: params.sectionId,
				};
			}

			if (
				logicalCellSource &&
				Object.is(contentDataRevision, dataRevision) &&
				Object.is(contentKeyRevision, keyRevision) &&
				contentVisibleCount === params.visibleCount &&
				contentHasHeader === params.hasHeader &&
				contentShowLoadMore === params.showLoadMore &&
				contentSectionId === params.sectionId
			) {
				return logicalCellSource;
			}

			contentDataRevision = dataRevision;
			contentKeyRevision = keyRevision;
			contentVisibleCount = params.visibleCount;
			contentHasHeader = params.hasHeader;
			contentShowLoadMore = params.showLoadMore;
			contentSectionId = params.sectionId;
			logicalCellSource = createFlatLogicalCellSource({
				header: params.hasHeader,
				items: params.items,
				getItemId: params.getItemId,
				visibleCount: params.visibleCount,
				showLoadMore: params.showLoadMore,
				sectionId: params.sectionId,
				revision: {
					data: dataRevision,
					key: keyRevision,
					visibleCount: params.visibleCount,
					hasHeader: params.hasHeader,
					showLoadMore: params.showLoadMore,
					sectionId: params.sectionId,
				},
				bindingTopologyRevision,
			});
			return logicalCellSource;
		},

		resolveRowModel(params: {
			cellSource: FlatLogicalCellSource<T>;
			layout: FlatGridLayoutMetrics;
		}): FlatLinkRowModel<T> {
			const { layout } = params;
			if (
				rowModel &&
				Object.is(rowModelCellSourceRevision, params.cellSource.revision) &&
				rowModelColumns === layout.columns &&
				rowModelCellWidth === layout.cellWidth &&
				rowModelRowHeight === layout.rowHeight &&
				rowModelGap === layout.gap &&
				rowModelRowCount === layout.rowCount
			) {
				return rowModel;
			}

			rowModelCellSourceRevision = params.cellSource.revision;
			rowModelColumns = layout.columns;
			rowModelCellWidth = layout.cellWidth;
			rowModelRowHeight = layout.rowHeight;
			rowModelGap = layout.gap;
			rowModelRowCount = layout.rowCount;
			rowModel = createFlatLinkRowModel({
				cellSource: params.cellSource,
				layout,
			});
			return rowModel;
		},
	};
}
