import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { VirtualListLogicalCell } from "../../logicalCell";
import { clampRange, type RowRange } from "../../rowRange";
import type { FlatLinkRowModel } from "../../row-models/flatLinkRowModel";
import type {
	RenderBodyKey,
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../../renderRevision";
import { logicalCellKey, type LogicalCellKey } from "../../types";
import type { ResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import {
	buildMountedGridRows,
	type MountedGridRow,
} from "ui/virtualization/core/reconciliation/mountedGridRows";

export interface MountedVirtualGridCell<T> {
	readonly key: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly cell: VirtualListLogicalCell<T>;
	readonly cellIndex: number;
	readonly renderBodyKey?: RenderBodyKey;
}

export type MountedVirtualGridRowSlice<T> = MountedGridRow<MountedVirtualGridCell<T>>;

export interface MountedVirtualGridCellsBuildResult<T> {
	readonly cells: MountedVirtualGridCell<T>[];
	readonly rowSlices: MountedVirtualGridRowSlice<T>[];
	readonly rowsBySlot: MountedVirtualGridRowSlice<T>[];
	readonly poolCapacity: number;
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
	cell: VirtualListLogicalCell<T>;
	cellIndex: number;
	rowIndex: number;
	columnIndex: number;
	renderSlotIndex: number;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): MountedVirtualGridCell<T> {
	const cell = params.cell;
	const cellIndex = params.cellIndex;
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

const hasSameMountedVirtualGridRowRange = <T>(
	build: MountedVirtualGridCellsBuildResult<T>,
	rowRange: RowRange,
): boolean => {
	const rows = build.rowSlices;
	if (rowRange.start >= rowRange.end) return rows.length === 0;
	return (
		rows.length === rowRange.end - rowRange.start &&
		rows[0]?.rowIndex === rowRange.start &&
		rows[rows.length - 1]?.rowIndex === rowRange.end - 1
	);
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
	const visibleRows = clampRange(params.rowRange, rowModel.rowCount);
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
		hasSameMountedVirtualGridRowRange(previousBuild, visibleRows)
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
	const mountedRows = buildMountedGridRows<
		VirtualListLogicalCell<T>,
		MountedVirtualGridCell<T>
	>({
		rowModel,
		rowRange: visibleRows,
		rowSlotAllocator,
		previousRows: hasCompatiblePreviousRowSlots
			? previousBuild?.rowSlices
			: undefined,
		canReusePreviousRows: hasCompatiblePreviousBuild,
		bindCell: ({ cell, previous, rowIndex, columnIndex, renderSlotIndex }) =>
			resolveMountedVirtualGridCell({
				cell,
				cellIndex: rowModel.getCellIndex(rowIndex, columnIndex),
				previous,
				rowIndex,
				columnIndex,
				renderSlotIndex,
				renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
			}),
	});

	const buildState: MountedVirtualGridCellsBuildResult<T> = {
		get cells() {
			return mountedRows.cells;
		},
		rowSlices: mountedRows.rowSlices,
		rowsBySlot: mountedRows.rowsBySlot,
		poolCapacity: rowSlotAllocator.capacity,
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
