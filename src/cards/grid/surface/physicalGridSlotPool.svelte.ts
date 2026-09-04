import type { MountedVirtualCell } from "cards/virtualization/public";
import type { CardGridMountedRow } from "./cardGridSurfaceTypes";

interface PhysicalGridCellSlot<TMountedCell extends MountedVirtualCell> {
	readonly physicalCellSlot: number;
	readonly binding: TMountedCell | null;
}

interface PhysicalGridRowSlot<TMountedCell extends MountedVirtualCell> {
	readonly physicalRowSlot: number;
	readonly active: boolean;
	readonly rowIndex: number;
	readonly top: number;
	readonly cells: readonly PhysicalGridCellSlot<TMountedCell>[];
}

interface PhysicalGridSlotPool<TMountedCell extends MountedVirtualCell> {
	readonly rows: readonly PhysicalGridRowSlot<TMountedCell>[];
	/** Publishes immutable mounted rows into stable, independently reactive slots. */
	sync(
		mountedRows: readonly CardGridMountedRow<TMountedCell>[],
		columns: number,
	): void;
}

interface MutablePhysicalGridCellSlot<
	TMountedCell extends MountedVirtualCell,
> extends PhysicalGridCellSlot<TMountedCell> {
	setBinding(binding: TMountedCell | null): void;
}

interface MutablePhysicalGridRowSlot<
	TMountedCell extends MountedVirtualCell,
> extends PhysicalGridRowSlot<TMountedCell> {
	readonly cells: readonly MutablePhysicalGridCellSlot<TMountedCell>[];
	setActive(active: boolean): void;
	setRow(row: CardGridMountedRow<TMountedCell>): void;
}

/**
 * Creates a high-water-mark pool of physical row and cell slots.
 *
 * The rows array changes only when capacity grows or the column topology changes.
 * An ordinary range shift writes signals only for rebound physical row slots.
 */
export function createPhysicalGridSlotPool<
	TMountedCell extends MountedVirtualCell,
>(): PhysicalGridSlotPool<TMountedCell> {
	let rows = $state.raw<readonly MutablePhysicalGridRowSlot<TMountedCell>[]>([]);
	let topologyColumns = 0;
	let sourceRowsBySlot: Array<CardGridMountedRow<TMountedCell> | undefined> = [];
	let activeSlotIndices: number[] = [];
	let nextActiveSlotIndices: number[] = [];
	let syncGeneration = 0;
	let seenGenerationBySlot: number[] = [];

	function reset(columns: number): void {
		rows = [];
		topologyColumns = columns;
		sourceRowsBySlot = [];
		activeSlotIndices = [];
		nextActiveSlotIndices = [];
		syncGeneration = 0;
		seenGenerationBySlot = [];
	}

	function ensureCapacity(capacity: number): void {
		if (rows.length >= capacity) return;

		const expanded = [...rows];
		for (
			let physicalRowSlot = expanded.length;
			physicalRowSlot < capacity;
			physicalRowSlot += 1
		) {
			expanded.push(createPhysicalRowSlot(physicalRowSlot, topologyColumns));
		}
		rows = expanded;
	}

	function sync(
		mountedRows: readonly CardGridMountedRow<TMountedCell>[],
		columns: number,
	): void {
		const normalizedColumns = resolveTopologyColumns(mountedRows, columns);
		if (topologyColumns !== normalizedColumns) {
			reset(normalizedColumns);
		}

		let requiredCapacity = rows.length;
		for (const row of mountedRows) {
			requiredCapacity = Math.max(requiredCapacity, row.physicalRowSlot + 1);
		}
		ensureCapacity(requiredCapacity);

		syncGeneration += 1;
		nextActiveSlotIndices.length = 0;
		for (const sourceRow of mountedRows) {
			const slotIndex = sourceRow.physicalRowSlot;
			const slot = rows[slotIndex];
			if (!slot) continue;

			seenGenerationBySlot[slotIndex] = syncGeneration;
			nextActiveSlotIndices.push(slotIndex);
			if (sourceRowsBySlot[slotIndex] === sourceRow && slot.active) continue;

			sourceRowsBySlot[slotIndex] = sourceRow;
			slot.setRow(sourceRow);
		}

		for (const slotIndex of activeSlotIndices) {
			if (seenGenerationBySlot[slotIndex] === syncGeneration) continue;
			sourceRowsBySlot[slotIndex] = undefined;
			rows[slotIndex]?.setActive(false);
		}

		const previousActiveSlotIndices = activeSlotIndices;
		activeSlotIndices = nextActiveSlotIndices;
		nextActiveSlotIndices = previousActiveSlotIndices;
	}

	return {
		get rows() {
			return rows;
		},
		sync,
	};
}

function resolveTopologyColumns<TMountedCell extends MountedVirtualCell>(
	mountedRows: readonly CardGridMountedRow<TMountedCell>[],
	columns: number,
): number {
	return Math.max(1, Math.floor(mountedRows[0]?.bindings.length ?? columns));
}

function createPhysicalRowSlot<TMountedCell extends MountedVirtualCell>(
	physicalRowSlot: number,
	columns: number,
): MutablePhysicalGridRowSlot<TMountedCell> {
	let active = $state(false);
	let rowIndex = $state(0);
	let top = $state(0);
	const cells = Array.from({ length: columns }, (_, columnIndex) =>
		createPhysicalCellSlot<TMountedCell>(physicalRowSlot * columns + columnIndex),
	);

	return {
		physicalRowSlot,
		get active() {
			return active;
		},
		get rowIndex() {
			return rowIndex;
		},
		get top() {
			return top;
		},
		cells,
		setActive(nextActive) {
			if (active === nextActive) return;
			active = nextActive;
			if (nextActive) return;

			for (const cell of cells) cell.setBinding(null);
		},
		setRow(row) {
			if (rowIndex !== row.rowIndex) rowIndex = row.rowIndex;
			if (top !== row.top) top = row.top;
			for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
				cells[columnIndex]?.setBinding(row.bindings[columnIndex] ?? null);
			}
			if (!active) active = true;
		},
	};
}

function createPhysicalCellSlot<TMountedCell extends MountedVirtualCell>(
	physicalCellSlot: number,
): MutablePhysicalGridCellSlot<TMountedCell> {
	let binding = $state.raw<TMountedCell | null>(null);

	return {
		physicalCellSlot,
		get binding() {
			return binding;
		},
		setBinding(nextBinding) {
			if (binding === nextBinding) return;
			binding = nextBinding;
		},
	};
}
