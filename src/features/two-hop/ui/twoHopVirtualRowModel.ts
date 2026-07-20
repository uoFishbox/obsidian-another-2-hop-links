import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type {
	TwoHopDocument,
	TwoHopDocumentSection,
} from "features/two-hop/ui/twoHopDocument";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";
import {
	compileFixedGridLayout,
	resolveSectionIndexForRow,
	resolveTwoHopCell,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleRowsInto,
	type TwoHopGeometry,
	type TwoHopResolvedCell,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import type { VirtualListLogicalCell } from "ui/virtualization/logicalCell";
import type { RowRange } from "ui/virtualization/rowRange";
import {
	createVirtualListLayoutRevisionToken,
	createVirtualListRevision,
} from "ui/virtualization/core/virtualListRevision";
import {
	logicalCellKey,
	sourceKey,
	type VirtualNavigationTarget,
	type VirtualRanges,
	type VirtualRow,
	type VirtualRowModel,
} from "ui/virtualization/types";
import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";
import type { VirtualScrollWindowRangeRowModel } from "ui/virtualization/core/scrollWindowMeasurement";

export type TwoHopLogicalCell =
	| (Extract<VirtualListLogicalCell<TwoHopVirtualListItem>, { kind: "header" }> & {
			readonly sectionIndex: number;
	  })
	| (Extract<VirtualListLogicalCell<TwoHopVirtualListItem>, { kind: "item" }> & {
			readonly sectionIndex: number;
	  })
	| (Extract<VirtualListLogicalCell<TwoHopVirtualListItem>, { kind: "load-more" }> & {
			readonly sectionIndex: number;
	  });

export type TwoHopVirtualRowModel = VirtualRowModel<TwoHopLogicalCell> &
	VirtualScrollWindowRangeRowModel & {
		readonly document: TwoHopDocument;
		readonly geometry: TwoHopGeometry;
		/** Stable allocator key for the layout that owns the physical row slots. */
		readonly residentSlotLayoutKey: object;
		getDocumentSection(rowIndex: number): TwoHopDocumentSection | null;
	};

type StableScrollTopBandMutable = {
	min: number;
	max: number;
};

interface ResolveRangesParams {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly mountedOverscanPx: number;
	readonly previewOverscanPx?: number;
	readonly mounted?: RowRange;
}

/** Adapts the compact TwoHop document geometry to the shared virtual-list engine. */
export function createTwoHopVirtualRowModel(
	document: TwoHopDocument,
	layout: ViewPlanLayoutMetrics,
	residentSlotLayoutKey: object = layout,
): TwoHopVirtualRowModel {
	const geometry = compileFixedGridLayout(document, layout);
	const mountedScratch: RowRange = { start: 0, end: 0 };
	const previewScratch: RowRange = { start: 0, end: 0 };

	const getDocumentSection = (rowIndex: number): TwoHopDocumentSection | null => {
		const sectionIndex = resolveSectionIndexForRow(geometry, rowIndex);
		return sectionIndex < 0 ? null : (document.sections[sectionIndex] ?? null);
	};

	const getRowCellCount = (rowIndex: number): number => {
		const sectionIndex = resolveSectionIndexForRow(geometry, rowIndex);
		const section = document.sections[sectionIndex];
		if (!section) return 0;
		const rowInSection = rowIndex - geometry.firstRowBySection[sectionIndex];
		const sectionCellCount =
			1 + section.visibleItemCount + (section.loadMore === null ? 0 : 1);
		return Math.min(
			geometry.columns,
			Math.max(0, sectionCellCount - rowInSection * geometry.columns),
		);
	};

	const resolveLogicalCell = (
		rowIndex: number,
		columnIndex: number,
	): TwoHopLogicalCell | null => {
		const resolved = resolveTwoHopCell(document, geometry, rowIndex, columnIndex);
		if (!resolved) return null;
		return createTwoHopLogicalCell(resolved);
	};

	const writeVisibleRange = (
		out: RowRange,
		scrollTop: number,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		if (
			geometry.rowCount === 0 ||
			viewportHeight <= 0 ||
			scrollTop + viewportHeight <= 0 ||
			scrollTop >= geometry.totalHeight
		) {
			out.start = 0;
			out.end = 0;
			return;
		}

		const overscan = Math.max(0, overscanPx);
		const rangeTop = Math.max(0, scrollTop - overscan);
		const rangeBottom = Math.min(
			geometry.totalHeight,
			scrollTop + viewportHeight + overscan,
		);
		resolveTwoHopVisibleRowsInto(
			out,
			geometry,
			rangeTop,
			Math.max(0, rangeBottom - rangeTop),
		);
	};

	const writeRanges = (out: VirtualRanges, params: ResolveRangesParams): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);

		if (params.mounted) {
			out.mounted.start = params.mounted.start;
			out.mounted.end = params.mounted.end;
		} else {
			writeVisibleRange(
				out.mounted,
				params.scrollTop,
				params.viewportHeight,
				mountedOverscanPx,
			);
		}

		if (previewOverscanPx >= mountedOverscanPx) {
			out.previewVisible.start = out.mounted.start;
			out.previewVisible.end = out.mounted.end;
			return;
		}

		writeVisibleRange(
			out.previewVisible,
			params.scrollTop,
			params.viewportHeight,
			previewOverscanPx,
		);
	};

	const writeStableBand = (
		out: StableScrollTopBandMutable,
		range: RowRange,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		if (range.start >= range.end || viewportHeight <= 0) {
			out.min = Number.POSITIVE_INFINITY;
			out.max = Number.NEGATIVE_INFINITY;
			return;
		}

		const rowBoundary = (rowIndex: number): number => {
			if (rowIndex <= 0) return 0;
			if (rowIndex >= geometry.rowCount) return geometry.totalHeight;
			return resolveTwoHopRowTop(geometry, rowIndex);
		};
		const overscan = Math.max(0, overscanPx);
		const startMin =
			range.start === 0
				? Number.NEGATIVE_INFINITY
				: rowBoundary(range.start) + overscan;
		const startMax = rowBoundary(range.start + 1) + overscan;
		const endMin = rowBoundary(range.end - 1) - viewportHeight - overscan + 1;
		const endMax =
			range.end >= geometry.rowCount
				? Number.POSITIVE_INFINITY
				: rowBoundary(range.end) - viewportHeight - overscan + 1;

		out.min = Math.max(startMin, endMin);
		out.max = Math.min(startMax, endMax);
		if (out.min >= out.max) {
			out.min = Number.POSITIVE_INFINITY;
			out.max = Number.NEGATIVE_INFINITY;
		}
	};

	const resolveDirectionalTarget = (
		direction: ResultNavigationDirection,
		rowIndex: number,
		columnIndex: number,
	): VirtualNavigationTarget | null => {
		const rowStep = direction === "up" ? -1 : direction === "down" ? 1 : 0;
		if (rowStep !== 0) {
			for (
				let nextRow = rowIndex + rowStep;
				nextRow >= 0 && nextRow < geometry.rowCount;
				nextRow += rowStep
			) {
				const sameColumn = resolveLogicalCell(nextRow, columnIndex);
				if (sameColumn) {
					return {
						key: sameColumn.key,
						rowTop: resolveTwoHopRowTop(geometry, nextRow),
					};
				}
				for (
					let fallbackColumn = geometry.columns - 1;
					fallbackColumn >= 0;
					fallbackColumn -= 1
				) {
					const fallback = resolveLogicalCell(nextRow, fallbackColumn);
					if (fallback) {
						return {
							key: fallback.key,
							rowTop: resolveTwoHopRowTop(geometry, nextRow),
						};
					}
				}
			}
			return null;
		}

		const step = direction === "left" ? -1 : 1;
		let linearIndex = rowIndex * geometry.columns + columnIndex + step;
		const linearEnd = geometry.rowCount * geometry.columns;
		while (linearIndex >= 0 && linearIndex < linearEnd) {
			const nextRow = Math.floor(linearIndex / geometry.columns);
			const nextColumn = linearIndex % geometry.columns;
			const cell = resolveLogicalCell(nextRow, nextColumn);
			if (cell) {
				return {
					key: cell.key,
					rowTop: resolveTwoHopRowTop(geometry, nextRow),
				};
			}
			linearIndex += step;
		}
		return null;
	};

	return {
		document,
		geometry,
		residentSlotLayoutKey,
		revision: createVirtualListRevision({
			content: document,
			layout: createVirtualListLayoutRevisionToken([
				layout.columns,
				layout.cellWidth,
				layout.rowHeight,
				layout.gap,
				layout.sectionMarginBottom,
			]),
		}),
		rowCount: geometry.rowCount,
		totalHeight: geometry.totalHeight,
		layout: { ...layout, contentHeight: geometry.totalHeight },
		getDocumentSection,
		getRow(rowIndex): VirtualRow<TwoHopLogicalCell> | null {
			const cellCount = getRowCellCount(rowIndex);
			if (cellCount === 0) return null;
			return {
				key: rowIndex,
				index: rowIndex,
				top: resolveTwoHopRowTop(geometry, rowIndex),
				height: geometry.rowHeight,
				bottomSpacing: geometry.rowStride - geometry.rowHeight,
				cellCount,
				getCell(columnIndex) {
					if (columnIndex < 0 || columnIndex >= cellCount) return null;
					return resolveLogicalCell(rowIndex, columnIndex);
				},
			};
		},
		getRowCellCount,
		getRowTop: (rowIndex) => resolveTwoHopRowTop(geometry, rowIndex),
		getRowEnd: (rowIndex) =>
			resolveTwoHopRowTop(geometry, rowIndex) + geometry.rowHeight,
		findVisibleRange(params) {
			writeVisibleRange(
				mountedScratch,
				params.scrollTop,
				params.viewportHeight,
				params.overscanPx,
			);
			return { ...mountedScratch };
		},
		findVisibleRangeInto: (out, params) => {
			writeVisibleRange(
				out,
				params.scrollTop,
				params.viewportHeight,
				params.overscanPx,
			);
		},
		findVisibleRanges(params) {
			const ranges: VirtualRanges = {
				mounted: { start: 0, end: 0 },
				previewVisible: { start: 0, end: 0 },
			};
			writeRanges(ranges, params);
			return ranges;
		},
		findVisibleRangesInto: (out, params) => writeRanges(out, params),
		findVisibleRangesFromMounted(params) {
			const ranges: VirtualRanges = {
				mounted: { ...params.mounted },
				previewVisible: { start: 0, end: 0 },
			};
			writeRanges(ranges, params);
			return ranges;
		},
		findVisibleRangesFromMountedInto: (out, params) => writeRanges(out, params),
		findStablePreviewScrollTopBandInto(out, params) {
			const mountedOverscan = Math.max(0, params.mountedOverscanPx);
			const previewOverscan = Math.min(
				mountedOverscan,
				Math.max(0, params.previewOverscanPx ?? 0),
			);
			if (previewOverscan >= mountedOverscan) {
				out.min = Number.NEGATIVE_INFINITY;
				out.max = Number.POSITIVE_INFINITY;
				return;
			}
			writeStableBand(
				out,
				params.previewVisible,
				params.viewportHeight,
				previewOverscan,
			);
		},
		findStableMountedScrollTopBandInto: (out, params) =>
			writeStableBand(
				out,
				params.mounted,
				params.viewportHeight,
				params.mountedOverscanPx,
			),
		resolveNavigationTarget: (_currentKey, direction, currentPosition) =>
			resolveDirectionalTarget(
				direction,
				currentPosition.rowIndex,
				currentPosition.columnIndex,
			),
	};
}

/** Converts resolved compact geometry data into the logical cell render contract. */
export function createTwoHopLogicalCell(
	resolved: TwoHopResolvedCell,
): TwoHopLogicalCell {
	switch (resolved.kind) {
		case "header":
			return {
				kind: "header",
				key: logicalCellKey(resolved.logicalKey),
				sectionIndex: resolved.sectionIndex,
			};
		case "item":
			return {
				kind: "item",
				key: logicalCellKey(resolved.logicalKey),
				sourceKey: sourceKey(resolved.item.virtualKey),
				item: resolved.item,
				itemIndex: resolved.itemIndex,
				sectionIndex: resolved.sectionIndex,
			};
		case "load-more":
			return {
				kind: "load-more",
				key: logicalCellKey(resolved.logicalKey),
				sectionIndex: resolved.sectionIndex,
			};
	}
}
