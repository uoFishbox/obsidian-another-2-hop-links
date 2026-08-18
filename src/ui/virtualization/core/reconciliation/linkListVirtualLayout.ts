import {
	computeVisibleCellWindow,
	type VisibleCellWindow,
} from "../../layout/flatGridLayout";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { VirtualListLogicalCell } from "../../logicalCell";
import { clampRange, sameRange, type RowRange } from "../../rowRange";
import type { FlatLinkRowModel } from "../../row-models/flatLinkRowModel";
import type {
	RenderBodyKey,
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../../renderRevision";
import { logicalCellKey, type LogicalCellKey } from "../../types";
import type { ResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { buildMountedSectionedGridRows } from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";

export interface MountedVirtualGridCell<T> {
	readonly key: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly cell: VirtualListLogicalCell<T>;
	readonly cellIndex: number;
	readonly renderBodyKey?: RenderBodyKey;
}

export interface MountedVirtualGridRowSlice<T> {
	readonly key: number;
	readonly slotIndex: number;
	rowIndex: number;
	top: number;
	bindings: Array<MountedVirtualGridCell<T> | null>;
}

export interface MountedVirtualGridCellsBuildResult<T> {
	readonly cells: MountedVirtualGridCell<T>[];
	readonly rowSlices: MountedVirtualGridRowSlice<T>[];
	readonly rowsBySlot: MountedVirtualGridRowSlice<T>[];
	readonly poolCapacity: number;
	readonly visibleWindow: VisibleCellWindow;
	readonly cellSourceRevision: unknown;
	/**
	 * Binding-topology revision captured by the same mounted-build commit as
	 * `rowsBySlot`. Consumers that key physical cell bodies must use this
	 * committed value rather than the eagerly derived logical-source revision.
	 */
	readonly bindingTopologyRevision: unknown;
	readonly columns: number;
	readonly cellWidth: number;
	readonly rowHeight: number;
	readonly gap: number;
}

const escapeRenderRevisionString = (value: string): string =>
	value.includes("\\") || value.includes("|")
		? value.replace(/\\/g, "\\\\").replace(/\|/g, "\\p")
		: value;

const encodeRenderRevisionToken = (value: RenderRevision): string => {
	if (value === null) return "null";
	if (typeof value === "boolean") return `b:${value}`;
	if (typeof value === "string") return `s:${escapeRenderRevisionString(value)}`;
	if (Number.isNaN(value)) return "n:NaN";
	if (Object.is(value, -0)) return "n:-0";
	return `n:${value}`;
};

const createMountedVirtualGridCellBodyKey = <T>(
	cell: VirtualListLogicalCell<T>,
	fallbackPolicy?: RenderRevisionFallbackPolicy,
): RenderBodyKey => {
	switch (cell.kind) {
		case "header":
			return `header|${encodeRenderRevisionToken(String(cell.key))}`;
		case "item": {
			let revision: RenderRevision = null;
			if (cell.itemRenderRevision !== undefined) {
				revision = cell.itemRenderRevision;
			} else if (fallbackPolicy === "required") {
				throw new Error(
					`Missing item render revision for sourceKey=${JSON.stringify(
						String(cell.sourceKey ?? cell.key),
					)} cellKey=${JSON.stringify(String(cell.key))}.`,
				);
			}
			return (
				"item|" +
				encodeRenderRevisionToken(String(cell.sourceKey ?? cell.key)) +
				"|" +
				encodeRenderRevisionToken(revision)
			);
		}
		case "load-more":
			return `load-more|${encodeRenderRevisionToken(String(cell.key))}`;
	}
};

const createMountedVirtualGridCell = <T>(params: {
	key: LogicalCellKey;
	cell: VirtualListLogicalCell<T>;
	cellIndex: number;
	rowIndex: number;
	renderSlotIndex: number;
	columnIndex: number;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): MountedVirtualGridCell<T> => {
	recordCCLDevMeasurement("virtualGrid.cellShellCreated");
	return {
		key: params.key,
		renderSlotIndex: params.renderSlotIndex,
		rowIndex: params.rowIndex,
		columnIndex: params.columnIndex,
		cell: params.cell,
		cellIndex: params.cellIndex,
		renderBodyKey: createMountedVirtualGridCellBodyKey(
			params.cell,
			params.renderRevisionFallbackPolicy,
		),
	};
};

function isSameLogicalCellForMountedReuse<T>(
	previous: VirtualListLogicalCell<T>,
	next: VirtualListLogicalCell<T>,
): boolean {
	if (previous.kind !== next.kind || previous.key !== next.key) {
		return false;
	}

	if (previous.kind === "item" && next.kind === "item") {
		return (
			previous.itemIndex === next.itemIndex &&
			previous.item === next.item &&
			Object.is(previous.itemRenderRevision, next.itemRenderRevision)
		);
	}

	return true;
}

function canReuseMountedVirtualGridCellView<T>(
	previous: MountedVirtualGridCell<T>,
	logicalKey: LogicalCellKey,
	cell: VirtualListLogicalCell<T>,
	cellIndex: number,
	rowIndex: number,
	columnIndex: number,
	renderSlotIndex: number,
): boolean {
	return (
		previous.key === logicalKey &&
		isSameLogicalCellForMountedReuse(previous.cell, cell) &&
		previous.cellIndex === cellIndex &&
		previous.rowIndex === rowIndex &&
		previous.columnIndex === columnIndex &&
		previous.renderSlotIndex === renderSlotIndex
	);
}

function updateMountedVirtualGridCell<T>(
	previous: MountedVirtualGridCell<T>,
	logicalKey: LogicalCellKey,
	cell: VirtualListLogicalCell<T>,
	cellIndex: number,
	rowIndex: number,
	columnIndex: number,
	renderSlotIndex: number,
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy,
): MountedVirtualGridCell<T> {
	const renderBodyKey = createMountedVirtualGridCellBodyKey(
		cell,
		renderRevisionFallbackPolicy,
	);

	recordCCLDevMeasurement("virtualGrid.cellShellRebound");
	return {
		...previous,
		key: logicalKey,
		cell,
		cellIndex,
		rowIndex,
		columnIndex,
		renderSlotIndex,
		renderBodyKey,
	};
}

function resolveMountedVirtualGridCell<T>(params: {
	previous?: MountedVirtualGridCell<T>;
	resolveCellAtIndex: (index: number) => VirtualListLogicalCell<T> | null;
	visibleWindowEnd: number;
	columns: number;
	rowIndex: number;
	columnIndex: number;
	renderSlotIndex: number;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): MountedVirtualGridCell<T> | null {
	const cellIndex = params.rowIndex * params.columns + params.columnIndex;
	if (cellIndex >= params.visibleWindowEnd) return null;

	const cell = params.resolveCellAtIndex(cellIndex);
	if (!cell) return null;

	const key = logicalCellKey(cell.key);
	if (params.previous) {
		if (
			canReuseMountedVirtualGridCellView(
				params.previous,
				key,
				cell,
				cellIndex,
				params.rowIndex,
				params.columnIndex,
				params.renderSlotIndex,
			)
		) {
			return params.previous;
		}

		return updateMountedVirtualGridCell(
			params.previous,
			key,
			cell,
			cellIndex,
			params.rowIndex,
			params.columnIndex,
			params.renderSlotIndex,
			params.renderRevisionFallbackPolicy,
		);
	}

	return createMountedVirtualGridCell({
		key,
		cell,
		cellIndex,
		rowIndex: params.rowIndex,
		renderSlotIndex: params.renderSlotIndex,
		renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
		columnIndex: params.columnIndex,
	});
}

const hasCompatibleMountedVirtualGridCellsBuild = <T>(
	previousBuild: MountedVirtualGridCellsBuildResult<T> | undefined,
	params: {
		cellSourceRevision: unknown;
		columns: number;
		cellWidth: number;
		rowHeight: number;
		gap: number;
	},
): previousBuild is MountedVirtualGridCellsBuildResult<T> =>
	previousBuild !== undefined &&
	Object.is(previousBuild.cellSourceRevision, params.cellSourceRevision) &&
	previousBuild.columns === params.columns &&
	previousBuild.cellWidth === params.cellWidth &&
	previousBuild.rowHeight === params.rowHeight &&
	previousBuild.gap === params.gap;

const hasCompatibleMountedVirtualGridRowSlots = <T>(
	previousBuild: MountedVirtualGridCellsBuildResult<T> | undefined,
	params: {
		columns: number;
		cellWidth: number;
		rowHeight: number;
		gap: number;
	},
): previousBuild is MountedVirtualGridCellsBuildResult<T> =>
	previousBuild !== undefined &&
	previousBuild.columns === params.columns &&
	previousBuild.cellWidth === params.cellWidth &&
	previousBuild.rowHeight === params.rowHeight &&
	previousBuild.gap === params.gap;

const getPreviousMountedVirtualGridRow = <T>(
	previousBuild: MountedVirtualGridCellsBuildResult<T> | undefined,
	rowIndex: number,
): MountedVirtualGridRowSlice<T> | undefined => {
	const previousRows = previousBuild?.rowSlices;
	if (!previousRows || previousRows.length === 0) {
		return undefined;
	}

	const firstRowIndex = previousRows[0].rowIndex;
	const previousRow = previousRows[rowIndex - firstRowIndex];
	return previousRow?.rowIndex === rowIndex ? previousRow : undefined;
};

const assertMountedVirtualGridBuildInvariants = <T>(
	build: MountedVirtualGridCellsBuildResult<T>,
): void => {
	if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
		return;
	}

	const renderSlotIndexes = new Set<number>();
	const logicalKeys = new Set<string>();
	for (const row of build.rowSlices) {
		for (let columnIndex = 0; columnIndex < row.bindings.length; columnIndex += 1) {
			const cell = row.bindings[columnIndex];
			if (!cell) continue;
			if (renderSlotIndexes.has(cell.renderSlotIndex)) {
				throw new Error(
					`Duplicate virtual-grid render slot index: ${cell.renderSlotIndex}.`,
				);
			}
			if (logicalKeys.has(cell.key)) {
				throw new Error(
					`Duplicate virtual-grid logical cell key: ${cell.key}.`,
				);
			}
			if (cell.rowIndex !== row.rowIndex) {
				throw new Error(
					`Virtual-grid row contains a cell from another row: ${cell.key}.`,
				);
			}
			if (
				cell.columnIndex !== columnIndex ||
				cell.renderSlotIndex !== row.slotIndex * build.columns + columnIndex
			) {
				throw new Error(
					`Virtual-grid cell render slot does not match its row slot: ${cell.key}.`,
				);
			}
			renderSlotIndexes.add(cell.renderSlotIndex);
			logicalKeys.add(cell.key);
		}
	}
};

export function buildMountedVirtualGridCellsFromRowModel<T>(params: {
	rowModel: FlatLinkRowModel<T>;
	rowRange: RowRange;
	previousBuild?: MountedVirtualGridCellsBuildResult<T>;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
	rowSlotAllocator: ResidentRowSlotAllocator;
}): MountedVirtualGridCellsBuildResult<T> {
	const { rowModel } = params;
	const columns = Math.max(1, rowModel.layout.columns);
	const cellCount = rowModel.cellCount;
	const visibleRows = clampRange(params.rowRange, rowModel.rowCount);
	const visibleWindow = computeVisibleCellWindow({
		cellCount,
		columns,
		rowRange: visibleRows,
	});
	const previousBuild = params.previousBuild;
	const cellSourceRevision = rowModel.cellSource.revision;
	const hasCompatiblePreviousBuild = hasCompatibleMountedVirtualGridCellsBuild(
		previousBuild,
		{
			cellSourceRevision,
			columns,
			cellWidth: rowModel.layout.cellWidth,
			rowHeight: rowModel.layout.rowHeight,
			gap: rowModel.layout.gap,
		},
	);
	if (
		hasCompatiblePreviousBuild &&
		sameRange(previousBuild.visibleWindow, visibleWindow)
	) {
		return previousBuild;
	}

	const hasCompatiblePreviousRowSlots = hasCompatibleMountedVirtualGridRowSlots(
		previousBuild,
		{
			columns,
			cellWidth: rowModel.layout.cellWidth,
			rowHeight: rowModel.layout.rowHeight,
			gap: rowModel.layout.gap,
		},
	);
	const { rowSlotAllocator } = params;
	rowSlotAllocator.prepareRange({
		start: visibleRows.start,
		end: visibleRows.end,
		slotTopologyRevision: columns,
	});

	const rowStep = rowModel.layout.rowHeight + rowModel.layout.gap;
	const mountedRows = buildMountedSectionedGridRows<
		MountedVirtualGridCell<T>,
		MountedVirtualGridRowSlice<T>,
		null
	>({
		rowRange: visibleRows,
		columns,
		slotCapacity: rowSlotAllocator.capacity,
		resolveSlotIndex: rowSlotAllocator.resolveSlotIndex,
		resolvePreviousRow: (rowIndex) =>
			hasCompatiblePreviousRowSlots
				? getPreviousMountedVirtualGridRow(previousBuild, rowIndex)
				: undefined,
		canReusePreviousRow: () => hasCompatiblePreviousBuild,
		resolveRow: (rowIndex) => ({
			top: rowIndex * rowStep,
			columnStart:
				Math.max(visibleWindow.start, rowIndex * columns) - rowIndex * columns,
			columnEnd:
				Math.min(visibleWindow.end, cellCount, (rowIndex + 1) * columns) -
				rowIndex * columns,
			metadata: null,
		}),
		resolveCell: ({ rowIndex, columnIndex, renderSlotIndex }) =>
			resolveMountedVirtualGridCell({
				resolveCellAtIndex: rowModel.resolveCellAtIndex,
				visibleWindowEnd: visibleWindow.end,
				columns,
				rowIndex,
				columnIndex,
				renderSlotIndex,
				renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
			}),
		rebindCell: ({ previous, rowIndex, columnIndex, renderSlotIndex }) =>
			resolveMountedVirtualGridCell({
				previous,
				resolveCellAtIndex: rowModel.resolveCellAtIndex,
				visibleWindowEnd: visibleWindow.end,
				columns,
				rowIndex,
				columnIndex,
				renderSlotIndex,
				renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
			}),
		createRow: ({ rowIndex, slotIndex, bindings, row }) => {
			recordCCLDevMeasurement("virtualGrid.rowShellCreated");
			return {
				key: rowIndex,
				slotIndex,
				rowIndex,
				top: row.top,
				bindings,
			};
		},
	});

	const buildState: MountedVirtualGridCellsBuildResult<T> = {
		get cells() {
			return mountedRows.cells;
		},
		rowSlices: mountedRows.rowSlices,
		rowsBySlot: mountedRows.rowsBySlot,
		poolCapacity: rowSlotAllocator.capacity,
		visibleWindow,
		cellSourceRevision,
		bindingTopologyRevision: rowModel.cellSource.bindingTopologyRevision,
		columns,
		cellWidth: rowModel.layout.cellWidth,
		rowHeight: rowModel.layout.rowHeight,
		gap: rowModel.layout.gap,
	};
	recordCCLDevMeasurement("virtualGrid.buildMountedRows");
	assertMountedVirtualGridBuildInvariants(buildState);
	return buildState;
}
