import {
	computeVisibleCellWindow,
	type VisibleCellWindow,
} from "../layout/flatGridLayout";
import { createArrayBackedFlatLogicalCellSource } from "../flatLogicalCellSource";
import type { VirtualListLogicalCell } from "../logicalCell";
import {
	clampRange,
	isEmptyRange,
	sameRange,
	type RowRange,
} from "../rowRange";
import type { FlatLinkRowModel } from "../row-models/flatLinkRowModel";
import type {
	RenderBodyKey,
	RenderRevisionFallbackPolicy,
} from "../renderRevision";
import {
	encodeResolvedItemRenderRevisionToken,
	encodeRenderRevisionToken,
	resolveItemRenderRevisionToken,
} from "./renderBodyRevision";
import {
	logicalCellKey,
	renderSlotKey,
	type LogicalCellKey,
	type RenderSlotKey,
} from "../types";
import type { VirtualizedItemVisibility } from "../../virtualizedItemVisibility";
import {
	assertVirtualListInvariant,
	shouldAssertVirtualListInvariants,
} from "./invariants";


export interface MountedVirtualGridCellPosition {
	readonly row: number;
	readonly column: number;
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

export interface MountedVirtualGridCell<T> {
	readonly key: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly renderSlotKey: RenderSlotKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly visibility?: VirtualizedItemVisibility;
	readonly cell: VirtualListLogicalCell<T>;
	readonly cellIndex: number;
	readonly cellMetadataKey?: unknown;
	readonly renderBodyKey?: RenderBodyKey;
	readonly position: MountedVirtualGridCellPosition;
	readonly cellSlotKey?: number;
}

export interface MountedVirtualGridRowSlice<T> {
	readonly key: number;
	readonly slotIndex: number;
	readonly slotKey: number;
	rowIndex: number;
	top: number;
	cells: MountedVirtualGridCell<T>[];
}

export interface MountedVirtualGridCellsBuildResult<T> {
	readonly cells: MountedVirtualGridCell<T>[];
	readonly rowSlices: MountedVirtualGridRowSlice<T>[];
	readonly reusableCellsByKey: Map<string, MountedVirtualGridCell<T>>;
	readonly nextRenderSlotIndex: number;
	readonly visibleWindow: VisibleCellWindow;
	readonly cellSourceRevision: unknown;
	readonly columns: number;
	readonly cellWidth: number;
	readonly rowHeight: number;
	readonly gap: number;
}

interface MountedVirtualGridCellsBuildState<
	T,
> extends MountedVirtualGridCellsBuildResult<T> {
	visibleWindow: VisibleCellWindow;
	cellSourceRevision: unknown;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}

interface VirtualGridCellResolver<T> {
	readonly revision: unknown;
	readonly cellCount: number;
	resolveCellAtIndex(index: number): VirtualListLogicalCell<T> | null;
}

interface VirtualGridRowSlot {
	readonly slotIndex: number;
	readonly slotKey: number;
}

const createVirtualGridRowSlot = (slotIndex: number): VirtualGridRowSlot => ({
	slotIndex,
	slotKey: slotIndex,
});

const createMountedVirtualGridCellBodyKey = <T>(
	cell: VirtualListLogicalCell<T>,
	fallbackPolicy?: RenderRevisionFallbackPolicy,
): RenderBodyKey => {
	switch (cell.kind) {
		case "header":
			return `header|${encodeRenderRevisionToken(String(cell.key))}`;
		case "item":
			return (
				"item|" +
				encodeRenderRevisionToken(String(cell.sourceKey ?? cell.key)) +
				"|" +
				encodeResolvedItemRenderRevisionToken(
					resolveItemRenderRevisionToken(cell, fallbackPolicy),
				)
			);
		case "load-more":
			return `load-more|${encodeRenderRevisionToken(String(cell.key))}`;
	}
};

const resolveMountedVirtualGridCellBodyKey = <T>(params: {
	previous?: MountedVirtualGridCell<T>;
	cell: VirtualListLogicalCell<T>;
	fallbackPolicy?: RenderRevisionFallbackPolicy;
}): RenderBodyKey => {
	const nextRenderBodyKey = createMountedVirtualGridCellBodyKey(
		params.cell,
		params.fallbackPolicy,
	);
	if (params.previous?.renderBodyKey === nextRenderBodyKey) {
		return params.previous.renderBodyKey;
	}
	return nextRenderBodyKey;
};

const createMountedVirtualGridCell = <T>(params: {
	key: LogicalCellKey;
	cell: VirtualListLogicalCell<T>;
	cellIndex: number;
	rowIndex: number;
	renderSlotIndex: number;
	position: MountedVirtualGridCellPosition;
	previous?: MountedVirtualGridCell<T>;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
	cellSlotKey?: number;
}): MountedVirtualGridCell<T> => ({
	key: params.key,
	renderSlotIndex: params.renderSlotIndex,
	renderSlotKey: renderSlotKey(params.renderSlotIndex),
	rowIndex: params.rowIndex,
	columnIndex: params.position.column,
	cell: params.cell,
	cellIndex: params.cellIndex,
	position: params.position,
	cellMetadataKey: [
		params.cell.key,
		params.position.top,
		params.position.left,
		params.position.width,
		params.position.height,
	],
	renderBodyKey: resolveMountedVirtualGridCellBodyKey({
		previous: params.previous,
		cell: params.cell,
		fallbackPolicy: params.renderRevisionFallbackPolicy,
	}),
	cellSlotKey: params.cellSlotKey,
});

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
			Object.is(
				previous.itemRenderRevision,
				next.itemRenderRevision,
			)
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
	top: number,
	left: number,
	width: number,
	height: number,
	renderSlotIndex: number,
): boolean {
	return (
		previous.key === logicalKey &&
		isSameLogicalCellForMountedReuse(previous.cell, cell) &&
		previous.cellIndex === cellIndex &&
		previous.position.row === rowIndex &&
		previous.position.column === columnIndex &&
		previous.position.top === top &&
		previous.position.left === left &&
		previous.position.width === width &&
		previous.position.height === height &&
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
	top: number,
	left: number,
	width: number,
	height: number,
	renderSlotIndex: number,
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy,
	cellSlotKey?: number,
): MountedVirtualGridCell<T> {
	const renderBodyKey = resolveMountedVirtualGridCellBodyKey({
		previous,
		cell,
		fallbackPolicy: renderRevisionFallbackPolicy,
	});

	if (
		previous.key === logicalKey &&
		isSameLogicalCellForMountedReuse(previous.cell, cell) &&
		previous.cellIndex === cellIndex &&
		previous.rowIndex === rowIndex &&
		previous.columnIndex === columnIndex &&
		previous.position.row === rowIndex &&
		previous.position.column === columnIndex &&
		previous.position.top === top &&
		previous.position.left === left &&
		previous.position.width === width &&
		previous.position.height === height &&
		previous.renderSlotIndex === renderSlotIndex &&
		previous.renderBodyKey === renderBodyKey
	) {
		return previous;
	}

	const position = {
		row: rowIndex,
		column: columnIndex,
		top,
		left,
		width,
		height,
	};
	const cellMetadataKey = [cell.key, top, left, width, height];
	return {
		...previous,
		key: logicalKey,
		cell,
		cellIndex,
		rowIndex,
		columnIndex,
		renderSlotIndex,
		renderSlotKey: renderSlotKey(renderSlotIndex),
		position,
		cellMetadataKey,
		renderBodyKey,
		cellSlotKey,
	};
}

const getMountedVirtualGridCellsBuildState = <T>(
	build: MountedVirtualGridCellsBuildResult<T> | undefined,
): MountedVirtualGridCellsBuildState<T> | undefined => {
	const state = build as MountedVirtualGridCellsBuildState<T> | undefined;
	if (!state?.visibleWindow || !("cellSourceRevision" in state)) {
		return undefined;
	}

	return state;
};

const clampVisibleWindow = (
	visibleWindow: VisibleCellWindow,
	cellCount: number,
): VisibleCellWindow => clampRange(visibleWindow, cellCount);

const resolveVisibleRowWindow = (
	visibleWindow: VisibleCellWindow,
	columns: number,
): RowRange => {
	if (isEmptyRange(visibleWindow)) {
		return { start: 0, end: 0 };
	}

	const resolvedColumns = Math.max(1, columns);
	return {
		start: Math.floor(visibleWindow.start / resolvedColumns),
		end: Math.ceil(visibleWindow.end / resolvedColumns),
	};
};

const isSameVisibleCellWindow = (
	current: VisibleCellWindow,
	next: VisibleCellWindow,
): boolean => sameRange(current, next);

const hasCompatibleMountedVirtualGridCellsBuild = <T>(
	previousBuild: MountedVirtualGridCellsBuildResult<T> | undefined,
	previousBuildState: MountedVirtualGridCellsBuildState<T> | undefined,
	params: {
		cellSourceRevision: unknown;
		columns: number;
		cellWidth: number;
		rowHeight: number;
		gap: number;
	},
): previousBuild is MountedVirtualGridCellsBuildResult<T> =>
	previousBuild !== undefined &&
	previousBuildState !== undefined &&
	Object.is(previousBuildState.cellSourceRevision, params.cellSourceRevision) &&
	previousBuild.columns === params.columns &&
	previousBuild.cellWidth === params.cellWidth &&
	previousBuild.rowHeight === params.rowHeight &&
	previousBuild.gap === params.gap;

const hasCompatibleMountedVirtualGridRowSlots = <T>(
	previousBuild: MountedVirtualGridCellsBuildResult<T> | undefined,
	previousBuildState: MountedVirtualGridCellsBuildState<T> | undefined,
	params: {
		columns: number;
		cellWidth: number;
		rowHeight: number;
		gap: number;
	},
): previousBuild is MountedVirtualGridCellsBuildResult<T> =>
	previousBuild !== undefined &&
	previousBuildState !== undefined &&
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

const canReuseMountedVirtualGridRow = <T>(
	row: MountedVirtualGridRowSlice<T> | undefined,
	rowStartIndex: number,
	rowEndIndex: number,
): row is MountedVirtualGridRowSlice<T> => {
	if (!row || row.cells.length !== rowEndIndex - rowStartIndex) {
		return false;
	}
	if (row.cells.length === 0) {
		return true;
	}

	return (
		row.cells[0].cellIndex === rowStartIndex &&
		row.cells[row.cells.length - 1].cellIndex === rowEndIndex - 1
	);
};

const assertMountedVirtualGridBuildInvariants = <T>(
	build: MountedVirtualGridCellsBuildResult<T>,
): void => {
	if (!shouldAssertVirtualListInvariants()) {
		return;
	}

	const renderSlotIndexes = new Set<number>();
	const logicalKeys = new Set<string>();

	for (const cell of build.cells) {
		assertVirtualListInvariant(
			!renderSlotIndexes.has(cell.renderSlotIndex),
			`Duplicate virtual-grid render slot index: ${cell.renderSlotIndex}.`,
		);
		assertVirtualListInvariant(
			!logicalKeys.has(cell.key),
			`Duplicate virtual-grid logical cell key: ${cell.key}.`,
		);
		assertVirtualListInvariant(
			build.reusableCellsByKey.get(cell.key) === cell,
			`Virtual-grid reuse map does not own mounted cell: ${cell.key}.`,
		);
		renderSlotIndexes.add(cell.renderSlotIndex);
		logicalKeys.add(cell.key);
	}

	assertVirtualListInvariant(
		build.reusableCellsByKey.size === build.cells.length,
		"Virtual-grid reuse map size must match the mounted cell count.",
	);

	for (const row of build.rowSlices) {
		for (const cell of row.cells) {
			assertVirtualListInvariant(
				cell.rowIndex === row.rowIndex,
				`Virtual-grid row slice contains a cell from another row: ${cell.key}.`,
			);
			assertVirtualListInvariant(
				cell.renderSlotIndex ===
					row.slotIndex * build.columns + cell.columnIndex,
				`Virtual-grid cell render slot does not match its row slot: ${cell.key}.`,
			);
		}
	}
};

function buildMountedVirtualGridCellsFromResolver<T>(params: {
	cellResolver: VirtualGridCellResolver<T>;
	visibleWindow: VisibleCellWindow;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
	previousBuild?: MountedVirtualGridCellsBuildResult<T>;
	previousCellsByKey?: ReadonlyMap<string, MountedVirtualGridCell<T>>;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): MountedVirtualGridCellsBuildResult<T> {
	const columns = Math.max(1, params.columns);
	const previousBuild = params.previousBuild;
	const previousBuildState =
		getMountedVirtualGridCellsBuildState(previousBuild);
	const visibleWindow = clampVisibleWindow(
		params.visibleWindow,
		params.cellResolver.cellCount,
	);
	const visibleRows = resolveVisibleRowWindow(visibleWindow, columns);
	const rowStep = params.rowHeight + params.gap;
	const colStep = params.cellWidth + params.gap;

	const hasCompatiblePreviousBuild = hasCompatibleMountedVirtualGridCellsBuild(
		previousBuild,
		previousBuildState,
		{
			cellSourceRevision: params.cellResolver.revision,
			columns,
			cellWidth: params.cellWidth,
			rowHeight: params.rowHeight,
			gap: params.gap,
		},
	);
	if (
		previousBuild &&
		previousBuildState &&
		hasCompatiblePreviousBuild &&
		isSameVisibleCellWindow(previousBuildState.visibleWindow, visibleWindow)
	) {
		return previousBuild;
	}
	const hasCompatiblePreviousRowSlots = hasCompatibleMountedVirtualGridRowSlots(
		previousBuild,
		previousBuildState,
		{
			columns,
			cellWidth: params.cellWidth,
			rowHeight: params.rowHeight,
			gap: params.gap,
		},
	);

	const rowSlotByLogicalRowIndex = new Map<number, VirtualGridRowSlot>();
	const nextLogicalRows = new Set<number>();
	for (
		let rowIndex = visibleRows.start;
		rowIndex < visibleRows.end;
		rowIndex += 1
	) {
		nextLogicalRows.add(rowIndex);
	}

	const freeRowSlots: VirtualGridRowSlot[] = [];
	let nextRowSlotIndex = 0;
	if (previousBuild && hasCompatiblePreviousRowSlots) {
		for (const previousRow of previousBuild.rowSlices) {
			nextRowSlotIndex = Math.max(
				nextRowSlotIndex,
				previousRow.slotIndex + 1,
			);
			const slot = {
				slotIndex: previousRow.slotIndex,
				slotKey: previousRow.slotKey,
			};
			if (nextLogicalRows.has(previousRow.rowIndex)) {
				rowSlotByLogicalRowIndex.set(previousRow.rowIndex, slot);
			} else {
				freeRowSlots.push(slot);
			}
		}
	}
	freeRowSlots.sort((left, right) => left.slotIndex - right.slotIndex);

	const acquireRowSlot = (rowIndex: number): VirtualGridRowSlot => {
		const retained = rowSlotByLogicalRowIndex.get(rowIndex);
		if (retained) {
			return retained;
		}

		const slot =
			freeRowSlots.shift() ?? createVirtualGridRowSlot(nextRowSlotIndex);
		if (slot.slotIndex >= nextRowSlotIndex) {
			nextRowSlotIndex = slot.slotIndex + 1;
		}
		rowSlotByLogicalRowIndex.set(rowIndex, slot);
		return slot;
	};

	const previousCellsByKey =
		previousBuild?.reusableCellsByKey ??
		params.previousCellsByKey ??
		new Map<string, MountedVirtualGridCell<T>>();
	const reusableCellsByKey = new Map<string, MountedVirtualGridCell<T>>();
	const rowSlices: MountedVirtualGridRowSlice<T>[] = [];
	const cells: MountedVirtualGridCell<T>[] = [];

	for (
		let rowIndex = visibleRows.start;
		rowIndex < visibleRows.end;
		rowIndex += 1
	) {
		const rowStartIndex = Math.max(visibleWindow.start, rowIndex * columns);
		const rowEndIndex = Math.min(
			visibleWindow.end,
			params.cellResolver.cellCount,
			(rowIndex + 1) * columns,
		);
		const rowSlot = acquireRowSlot(rowIndex);
		const previousRow = hasCompatiblePreviousBuild
			? getPreviousMountedVirtualGridRow(previousBuild, rowIndex)
			: undefined;
		if (
			canReuseMountedVirtualGridRow(
				previousRow,
				rowStartIndex,
				rowEndIndex,
			) &&
			previousRow.slotIndex === rowSlot.slotIndex
		) {
			rowSlices.push(previousRow);
			for (const mountedCell of previousRow.cells) {
				cells.push(mountedCell);
				reusableCellsByKey.set(mountedCell.key, mountedCell);
			}
			continue;
		}
		const rowCells: MountedVirtualGridCell<T>[] = [];

		for (
			let cellIndex = rowStartIndex;
			cellIndex < rowEndIndex;
			cellIndex += 1
		) {
			const cell = params.cellResolver.resolveCellAtIndex(cellIndex);
			if (!cell || cellIndex >= visibleWindow.end) {
				continue;
			}
			const columnIndex = cellIndex % columns;
			const renderSlotIndex = rowSlot.slotIndex * columns + columnIndex;
			const cellSlotKey = renderSlotIndex;
			const key = logicalCellKey(cell.key);
			const top = rowIndex * rowStep;
			const left = columnIndex * colStep;
			const width = params.cellWidth;
			const height = params.rowHeight;
			const cellIndexReuse = rowIndex * columns + columnIndex;
			const previous = previousCellsByKey.get(key);
			const mountedCell =
				previous &&
				canReuseMountedVirtualGridCellView(
					previous,
					key,
					cell,
					cellIndexReuse,
					rowIndex,
					columnIndex,
					top,
					left,
					width,
					height,
					renderSlotIndex,
				)
					? previous
					: previous
						? updateMountedVirtualGridCell(
								previous,
								key,
								cell,
								cellIndexReuse,
								rowIndex,
								columnIndex,
								top,
								left,
								width,
								height,
								renderSlotIndex,
								params.renderRevisionFallbackPolicy,
								cellSlotKey,
							)
						: createMountedVirtualGridCell({
								key,
								cell,
								cellIndex: cellIndexReuse,
								rowIndex,
								renderSlotIndex,
								previous,
								renderRevisionFallbackPolicy:
									params.renderRevisionFallbackPolicy,
								cellSlotKey,
								position: {
									row: rowIndex,
									column: columnIndex,
									top,
									left,
									width,
									height,
								},
							});

			rowCells.push(mountedCell);
			cells.push(mountedCell);
			reusableCellsByKey.set(mountedCell.key, mountedCell);
		}

		rowSlices.push({
			key: rowIndex,
			slotIndex: rowSlot.slotIndex,
			slotKey: rowSlot.slotKey,
			rowIndex,
			top: rowIndex * rowStep,
			cells: rowCells,
		});
	}

	const buildState = {
		cells,
		rowSlices,
		reusableCellsByKey,
		nextRenderSlotIndex: nextRowSlotIndex * columns,
		visibleWindow,
		cellSourceRevision: params.cellResolver.revision,
		columns,
		cellWidth: params.cellWidth,
		rowHeight: params.rowHeight,
		gap: params.gap,
	} satisfies MountedVirtualGridCellsBuildState<T>;
	assertMountedVirtualGridBuildInvariants(buildState);
	return buildState;
}

export function buildMountedVirtualGridCells<T>(params: {
	logicalCells: readonly VirtualListLogicalCell<T>[];
	visibleWindow: VisibleCellWindow;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
	previousBuild?: MountedVirtualGridCellsBuildResult<T>;
	previousCellsByKey?: ReadonlyMap<string, MountedVirtualGridCell<T>>;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): MountedVirtualGridCellsBuildResult<T> {
	return buildMountedVirtualGridCellsFromResolver({
		cellResolver: createArrayBackedFlatLogicalCellSource(params.logicalCells),
		visibleWindow: params.visibleWindow,
		columns: params.columns,
		cellWidth: params.cellWidth,
		rowHeight: params.rowHeight,
		gap: params.gap,
		previousBuild: params.previousBuild,
		previousCellsByKey: params.previousCellsByKey,
		renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
	});
}

export function buildMountedVirtualGridCellsFromRowModel<T>(params: {
	rowModel: FlatLinkRowModel<T>;
	rowRange: RowRange;
	previousBuild?: MountedVirtualGridCellsBuildResult<T>;
	previousCellsByKey?: ReadonlyMap<string, MountedVirtualGridCell<T>>;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): MountedVirtualGridCellsBuildResult<T> {
	const { rowModel } = params;
	return buildMountedVirtualGridCellsFromResolver({
		cellResolver: {
			revision: rowModel.cellSource.revision,
			cellCount: rowModel.cellCount,
			resolveCellAtIndex: (index) => rowModel.resolveCellAtIndex(index),
		},
		visibleWindow: computeVisibleCellWindow({
			cellCount: rowModel.cellCount,
			columns: rowModel.layout.columns,
			rowRange: params.rowRange,
		}),
		columns: rowModel.layout.columns,
		cellWidth: rowModel.layout.cellWidth,
		rowHeight: rowModel.layout.rowHeight,
		gap: rowModel.layout.gap,
		previousBuild: params.previousBuild,
		previousCellsByKey: params.previousCellsByKey,
		renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
	});
}
