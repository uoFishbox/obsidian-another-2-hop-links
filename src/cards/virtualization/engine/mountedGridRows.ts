import { clampRange, type RowRange } from "cards/virtualization/model/ranges";
import type {
	MountedVirtualCell,
	VirtualRowModel,
} from "cards/virtualization/model/types";

export interface MountedGridRow<TCell extends MountedVirtualCell> {
	readonly physicalRowSlot: number;
	readonly rowIndex: number;
	readonly top: number;
	readonly bindings: readonly (TCell | null)[];
}

export interface MountedGridRows<TCell extends MountedVirtualCell> {
	readonly rowsInMountedRange: MountedGridRow<TCell>[];
}

export interface BuildMountedGridRowsParams<
	TLogicalCell,
	TCell extends MountedVirtualCell,
> {
	readonly rowModel: VirtualRowModel<TLogicalCell>;
	readonly rowRange: RowRange;
	readonly rowSlotAllocator: ResidentRowSlotAllocator;
	/** Previous contiguous logical rows. Omit when physical slot topology changed. */
	readonly previousRows?: readonly MountedGridRow<TCell>[];
	/** Reuse an unchanged previous row shell without resolving its logical row. */
	readonly canReusePreviousRows?: boolean;
	bindCell(params: {
		readonly cell: TLogicalCell;
		readonly previous?: TCell;
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly physicalCellSlot: number;
	}): TCell;
}

/** Builds resident grid rows directly from the shared virtual row-model contract. */
export function buildMountedGridRows<TLogicalCell, TCell extends MountedVirtualCell>(
	params: BuildMountedGridRowsParams<TLogicalCell, TCell>,
): MountedGridRows<TCell> {
	const { rowModel, rowSlotAllocator } = params;
	const columns = Math.max(1, rowModel.layout.columns);
	const rowRange = clampRange(params.rowRange, rowModel.rowCount);
	rowSlotAllocator.prepareRange({
		start: rowRange.start,
		end: rowRange.end,
		slotTopologyRevision: columns,
	});

	const previousRows = params.previousRows;
	const previousFirstRowIndex = previousRows?.[0]?.rowIndex ?? 0;
	const rowsInMountedRange: MountedGridRow<TCell>[] = [];

	for (let rowIndex = rowRange.start; rowIndex < rowRange.end; rowIndex += 1) {
		const physicalRowSlot = rowSlotAllocator.resolveSlotIndex(rowIndex);
		if (physicalRowSlot === undefined) {
			throw new Error(`No resident slot assigned for row ${rowIndex}.`);
		}

		const previousRow = previousRows?.[rowIndex - previousFirstRowIndex];
		const matchingPreviousRow =
			previousRow?.rowIndex === rowIndex ? previousRow : undefined;
		if (
			params.canReusePreviousRows &&
			matchingPreviousRow?.physicalRowSlot === physicalRowSlot
		) {
			rowsInMountedRange.push(matchingPreviousRow);
			continue;
		}

		const row = rowModel.getRow(rowIndex);
		if (!row) continue;
		const previousBindings =
			matchingPreviousRow?.bindings.length === columns
				? matchingPreviousRow.bindings
				: undefined;
		const bindings: (TCell | null)[] = [];
		for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
			if (columnIndex >= row.cellCount) {
				bindings.push(null);
				continue;
			}
			const cell = row.getCell(columnIndex);
			if (!cell) {
				bindings.push(null);
				continue;
			}
			const physicalCellSlot = physicalRowSlot * columns + columnIndex;
			bindings.push(
				params.bindCell({
					cell,
					previous: previousBindings?.[columnIndex] ?? undefined,
					rowIndex,
					columnIndex,
					physicalCellSlot,
				}),
			);
		}

		rowsInMountedRange.push({
			physicalRowSlot,
			rowIndex,
			top: row.top,
			bindings,
		});
	}

	assertMountedGridRows({
		rows: rowsInMountedRange,
		slotCapacity: rowSlotAllocator.capacity,
		columns,
	});

	return { rowsInMountedRange };
}

export interface ResidentRowSlotRange {
	readonly start: number;
	readonly end: number;
	/**
	 * Revision of the mapping between a logical row and its physical cell slots.
	 *
	 * Grid consumers use their column count. Pure geometry changes such as row
	 * height, gap, or cell width must not change this revision.
	 */
	readonly slotTopologyRevision: number;
}

export interface ResidentRowSlotAllocator {
	/** Reconciles a bounded physical slot pool with a contiguous integer row range. */
	prepareRange(params: ResidentRowSlotRange): void;
	resolveSlotIndex(logicalRowIndex: number): number | undefined;
	reset(): void;
	dispose(): void;
	readonly capacity: number;
}

/** Creates the authoritative free-list slot lifecycle used by resident row windows. */
export function createResidentRowSlotAllocator(): ResidentRowSlotAllocator {
	let capacity = 0;
	let slotTopologyRevision = 0;
	let hasSlotTopologyRevision = false;
	let activeStart = 0;
	let activeEnd = 0;
	let hasActiveRange = false;
	let disposed = false;
	const logicalRowToSlot = new Map<number, number>();
	const freeSlotIndices = new Set<number>();
	// Reused across range shifts so prepareRange stays allocation-free.
	const leavingSlotIndicesScratch: number[] = [];

	function assertUsable(): void {
		if (disposed) {
			throw new Error("Resident row slot allocator has been disposed");
		}
	}

	function reset(): void {
		assertUsable();
		capacity = 0;
		slotTopologyRevision = 0;
		hasSlotTopologyRevision = false;
		activeStart = 0;
		activeEnd = 0;
		hasActiveRange = false;
		logicalRowToSlot.clear();
		freeSlotIndices.clear();
	}

	function prepareRange(params: ResidentRowSlotRange): void {
		assertUsable();
		const start = Math.max(0, Math.floor(params.start));
		const end = Math.max(start, Math.floor(params.end));
		if (
			hasSlotTopologyRevision &&
			Object.is(slotTopologyRevision, params.slotTopologyRevision) &&
			hasActiveRange &&
			activeStart === start &&
			activeEnd === end
		) {
			return;
		}

		if (
			hasSlotTopologyRevision &&
			!Object.is(slotTopologyRevision, params.slotTopologyRevision)
		) {
			reset();
		}
		slotTopologyRevision = params.slotTopologyRevision;
		hasSlotTopologyRevision = true;

		const leavingSlotIndices = leavingSlotIndicesScratch;
		leavingSlotIndices.length = 0;
		for (const [logicalRowIndex, physicalRowSlot] of logicalRowToSlot) {
			if (logicalRowIndex >= start && logicalRowIndex < end) continue;
			logicalRowToSlot.delete(logicalRowIndex);
			leavingSlotIndices.push(physicalRowSlot);
		}

		let leavingOffset = 0;
		for (let logicalRowIndex = start; logicalRowIndex < end; logicalRowIndex += 1) {
			if (logicalRowToSlot.has(logicalRowIndex)) continue;

			const reboundSlotIndex = leavingSlotIndices[leavingOffset];
			if (reboundSlotIndex !== undefined) leavingOffset += 1;
			const previouslyFreeSlotIndex =
				reboundSlotIndex === undefined
					? freeSlotIndices.values().next().value
					: undefined;
			const physicalRowSlot =
				reboundSlotIndex ?? previouslyFreeSlotIndex ?? allocateSlot();
			if (previouslyFreeSlotIndex !== undefined) {
				freeSlotIndices.delete(previouslyFreeSlotIndex);
			}
			logicalRowToSlot.set(logicalRowIndex, physicalRowSlot);
		}

		for (let index = leavingOffset; index < leavingSlotIndices.length; index += 1) {
			freeSlotIndices.add(leavingSlotIndices[index]!);
		}

		activeStart = start;
		activeEnd = end;
		hasActiveRange = true;
	}

	function allocateSlot(): number {
		const physicalRowSlot = capacity;
		capacity += 1;
		return physicalRowSlot;
	}

	function resolveSlotIndex(logicalRowIndex: number): number | undefined {
		assertUsable();
		return logicalRowToSlot.get(logicalRowIndex);
	}

	function dispose(): void {
		if (disposed) return;
		reset();
		disposed = true;
	}

	return {
		prepareRange,
		resolveSlotIndex,
		reset,
		dispose,
		get capacity() {
			return capacity;
		},
	};
}

function assertMountedGridRows<TCell extends MountedVirtualCell>(params: {
	readonly rows: readonly MountedGridRow<TCell>[];
	readonly slotCapacity: number;
	readonly columns: number;
}): void {
	if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
		return;
	}

	const logicalRows = new Set<number>();
	const rowSlots = new Set<number>();
	const logicalCellKeys = new Set<string>();
	const physicalCellSlots = new Set<number>();
	for (const row of params.rows) {
		if (logicalRows.has(row.rowIndex)) {
			throw new Error(`Duplicate mounted logical row: ${row.rowIndex}.`);
		}
		if (
			row.physicalRowSlot < 0 ||
			row.physicalRowSlot >= params.slotCapacity ||
			rowSlots.has(row.physicalRowSlot)
		) {
			throw new Error(
				`Invalid or duplicate mounted row slot: ${row.physicalRowSlot}.`,
			);
		}
		if (row.bindings.length !== params.columns) {
			throw new Error(
				`Mounted row ${row.rowIndex} has ${row.bindings.length} bindings; expected ${params.columns}.`,
			);
		}
		logicalRows.add(row.rowIndex);
		rowSlots.add(row.physicalRowSlot);

		for (let columnIndex = 0; columnIndex < row.bindings.length; columnIndex += 1) {
			const binding = row.bindings[columnIndex];
			if (!binding) continue;
			if (binding.rowIndex !== row.rowIndex) {
				throw new Error(
					`Mounted cell ${binding.key} belongs to row ${binding.rowIndex}; expected ${row.rowIndex}.`,
				);
			}
			if (logicalCellKeys.has(binding.key)) {
				throw new Error(`Duplicate mounted logical cell key: ${binding.key}.`);
			}
			if (physicalCellSlots.has(binding.physicalCellSlot)) {
				throw new Error(
					`Duplicate mounted physical cell slot: ${binding.physicalCellSlot}.`,
				);
			}
			const expectedSlotIndex =
				row.physicalRowSlot * params.columns + columnIndex;
			if (binding.physicalCellSlot !== expectedSlotIndex) {
				throw new Error(
					`Mounted cell render slot ${binding.physicalCellSlot} does not match physical slot ${expectedSlotIndex}.`,
				);
			}
			if (
				binding.columnIndex !== undefined &&
				binding.columnIndex !== columnIndex
			) {
				throw new Error(
					`Mounted cell column ${binding.columnIndex} does not match physical column ${columnIndex}.`,
				);
			}
			logicalCellKeys.add(binding.key);
			physicalCellSlots.add(binding.physicalCellSlot);
		}
	}
}
