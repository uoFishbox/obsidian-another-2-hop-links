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
import type {
	LayoutRevision,
	TwoHopLayoutPublication,
} from "features/two-hop/ui/twoHopRevisions";
import {
	createMutableVirtualRanges,
	resolveVirtualRangesInto,
	resolveVisibleRange,
	type ResolveVirtualRangesParams,
} from "ui/virtualization/virtualRanges";

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
		readonly layoutRevision: LayoutRevision;
		getDocumentSection(rowIndex: number): TwoHopDocumentSection | null;
	};

type StableScrollTopBandMutable = {
	min: number;
	max: number;
};

/** Adapts the compact TwoHop document geometry to the shared virtual-list engine. */
export function createTwoHopVirtualRowModel(
	document: TwoHopDocument,
	layoutPublication: TwoHopLayoutPublication,
): TwoHopVirtualRowModel {
	const layout: ViewPlanLayoutMetrics = layoutPublication.metrics;
	const geometry = compileFixedGridLayout(document, layout);

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

	const writeVisibleRangeInto = (
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

	const resolveMountedAndPreviewRangesInto = (
		out: VirtualRanges,
		params: ResolveVirtualRangesParams,
	): VirtualRanges => resolveVirtualRangesInto(out, params, writeVisibleRangeInto);

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

		const rowTop = (rowIndex: number): number => {
			if (rowIndex <= 0) return 0;
			if (rowIndex >= geometry.rowCount) return geometry.totalHeight;
			return resolveTwoHopRowTop(geometry, rowIndex);
		};
		const rowBottom = (rowIndex: number): number =>
			resolveTwoHopRowTop(geometry, rowIndex) + geometry.rowHeight;
		const overscan = Math.max(0, overscanPx);
		const startMin =
			range.start === 0
				? Number.NEGATIVE_INFINITY
				: rowBottom(range.start - 1) + overscan;
		const startMax = rowBottom(range.start) + overscan;
		const endMin = rowTop(range.end - 1) - viewportHeight - overscan;
		const endMax =
			range.end >= geometry.rowCount
				? Number.POSITIVE_INFINITY
				: rowTop(range.end) - viewportHeight - overscan;

		out.min = Math.max(startMin, endMin, -viewportHeight);
		out.max = Math.min(startMax, endMax, geometry.totalHeight);
		if (out.min >= out.max) {
			out.min = Number.POSITIVE_INFINITY;
			out.max = Number.NEGATIVE_INFINITY;
		}
	};
	const writeCoverageBand = (
		out: StableScrollTopBandMutable,
		range: RowRange,
		viewportHeight: number,
		requiredOverscanPx: number,
	): void => {
		if (range.start >= range.end || viewportHeight <= 0) {
			out.min = Number.POSITIVE_INFINITY;
			out.max = Number.NEGATIVE_INFINITY;
			return;
		}

		const rowTop = (rowIndex: number): number => {
			if (rowIndex <= 0) return 0;
			if (rowIndex >= geometry.rowCount) return geometry.totalHeight;
			return resolveTwoHopRowTop(geometry, rowIndex);
		};
		const requiredOverscan = Math.max(0, requiredOverscanPx);
		out.min =
			range.start === 0
				? -viewportHeight
				: resolveTwoHopRowTop(geometry, range.start - 1) +
					geometry.rowHeight +
					requiredOverscan;
		out.max =
			range.end >= geometry.rowCount
				? geometry.totalHeight
				: rowTop(range.end) - viewportHeight - requiredOverscan;
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
		layoutRevision: layoutPublication.revision,
		revision: createVirtualListRevision({
			content: document.revision,
			layout: createVirtualListLayoutRevisionToken([layoutPublication.revision]),
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
		findVisibleRange: (params) =>
			resolveVisibleRange(writeVisibleRangeInto, params),
		findVisibleRangeInto: (out, params) => {
			writeVisibleRangeInto(
				out,
				params.scrollTop,
				params.viewportHeight,
				params.overscanPx,
			);
		},
		findVisibleRanges(params) {
			return resolveMountedAndPreviewRangesInto(createMutableVirtualRanges(), {
				...params,
				reuseMountedReference: true,
			});
		},
		findVisibleRangesInto: (out, params) => {
			resolveMountedAndPreviewRangesInto(out, params);
		},
		findVisibleRangesFromMounted(params) {
			return resolveMountedAndPreviewRangesInto(createMutableVirtualRanges(), {
				...params,
				reuseMountedReference: true,
			});
		},
		findVisibleRangesFromMountedInto: (out, params) => {
			resolveMountedAndPreviewRangesInto(out, params);
		},
		findStableMountedScrollTopBandInto: (out, params) =>
			writeStableBand(
				out,
				params.mounted,
				params.viewportHeight,
				params.mountedOverscanPx,
			),
		findMountedCoverageScrollTopBandInto: (out, params) =>
			writeCoverageBand(
				out,
				params.mounted,
				params.viewportHeight,
				params.requiredOverscanPx,
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
