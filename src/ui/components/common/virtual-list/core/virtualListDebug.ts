import type { RowRange } from "../rowRange";
import type { MountedVirtualCell, VirtualRanges } from "../types";
import type { MaterializedVirtualListMode } from "./VirtualListMode";
import type {
	MountedVirtualCellsBuild,
	VirtualListSnapshot,
} from "./virtualListEngine";

export interface VirtualListDebugSnapshot {
	ranges: VirtualRanges;
	totalHeight: number;
	mountedCount: number;
	mode: MaterializedVirtualListMode;
	renderSlots: readonly number[];
	mountedCellsParity?: VirtualListMountedCellsParity;
}

export interface VirtualListMountedCellsParity {
	ok: boolean;
	snapshotCount: number;
	renderedCount: number;
	firstMismatch?: VirtualListMountedCellMismatch;
}

export interface VirtualListMountedCellMismatch {
	index: number;
	field: string;
	snapshot: unknown;
	rendered: unknown;
}

export interface VirtualListDebugState {
	virtualLists?: Record<string, VirtualListDebugSnapshot>;
}

declare global {
	interface Window {
		__CCL_DEBUG__?: VirtualListDebugState;
	}
}

const cloneRange = (range: RowRange): RowRange => ({
	start: range.start,
	end: range.end,
});

const cloneRanges = (ranges: VirtualRanges): VirtualRanges => ({
	mounted: cloneRange(ranges.mounted),
	previewVisible: cloneRange(ranges.previewVisible),
});

export function createVirtualListDebugSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
): VirtualListDebugSnapshot {
	const debugSnapshot: VirtualListDebugSnapshot = {
		ranges: cloneRanges(snapshot.ranges),
		totalHeight: snapshot.totalHeight,
		mountedCount: snapshot.mountedCells.length,
		mode: snapshot.mode,
		renderSlots: snapshot.mountedCells.map((cell) => cell.renderSlotIndex),
	};

	return debugSnapshot;
}

export function publishVirtualListDebugSnapshot<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	name: string | undefined;
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>;
	target?: VirtualListDebugState;
}): void {
	if (!params.name) {
		return;
	}

	const target = params.target ?? resolveWindowDebugTarget();
	if (!target) {
		return;
	}

	target.virtualLists ??= {};
	target.virtualLists[params.name] = createVirtualListDebugSnapshot(params.snapshot);
}

const getCellPosition = (
	cell: MountedVirtualCell,
): { top?: number; left?: number; width?: number; height?: number } => {
	const candidate = cell as MountedVirtualCell & {
		readonly position?: {
			readonly top?: number;
			readonly left?: number;
			readonly width?: number;
			readonly height?: number;
		};
	};

	return candidate.position ?? {};
};

const createMismatch = (
	index: number,
	field: string,
	snapshot: unknown,
	rendered: unknown,
): VirtualListMountedCellMismatch => ({
	index,
	field,
	snapshot,
	rendered,
});

const compareMountedCell = (
	index: number,
	snapshotCell: MountedVirtualCell,
	renderedCell: MountedVirtualCell,
): VirtualListMountedCellMismatch | undefined => {
	if (snapshotCell.key !== renderedCell.key) {
		return createMismatch(index, "key", snapshotCell.key, renderedCell.key);
	}
	if (snapshotCell.renderSlotKey !== renderedCell.renderSlotKey) {
		return createMismatch(
			index,
			"renderSlotKey",
			snapshotCell.renderSlotKey,
			renderedCell.renderSlotKey,
		);
	}
	if (snapshotCell.renderSlotIndex !== renderedCell.renderSlotIndex) {
		return createMismatch(
			index,
			"renderSlotIndex",
			snapshotCell.renderSlotIndex,
			renderedCell.renderSlotIndex,
		);
	}
	if (
		(snapshotCell.visibility !== undefined ||
			renderedCell.visibility !== undefined) &&
		snapshotCell.visibility !== renderedCell.visibility
	) {
		return createMismatch(
			index,
			"visibility",
			snapshotCell.visibility,
			renderedCell.visibility,
		);
	}

	const snapshotPosition = getCellPosition(snapshotCell);
	const renderedPosition = getCellPosition(renderedCell);
	for (const field of ["top", "left", "width", "height"] as const) {
		if (snapshotPosition[field] !== renderedPosition[field]) {
			return createMismatch(
				index,
				`position.${field}`,
				snapshotPosition[field],
				renderedPosition[field],
			);
		}
	}

	return undefined;
};

export function createVirtualListMountedCellsParity<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(
	snapshot: VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>,
	renderedCells: readonly TMountedCell[],
): VirtualListMountedCellsParity {
	const maxLength = Math.max(snapshot.mountedCells.length, renderedCells.length);
	for (let index = 0; index < maxLength; index += 1) {
		const snapshotCell = snapshot.mountedCells[index];
		const renderedCell = renderedCells[index];
		if (!snapshotCell || !renderedCell) {
			return {
				ok: false,
				snapshotCount: snapshot.mountedCells.length,
				renderedCount: renderedCells.length,
				firstMismatch: createMismatch(
					index,
					"count",
					snapshotCell?.key,
					renderedCell?.key,
				),
			};
		}

		const mismatch = compareMountedCell(index, snapshotCell, renderedCell);
		if (mismatch) {
			return {
				ok: false,
				snapshotCount: snapshot.mountedCells.length,
				renderedCount: renderedCells.length,
				firstMismatch: mismatch,
			};
		}
	}

	return {
		ok: true,
		snapshotCount: snapshot.mountedCells.length,
		renderedCount: renderedCells.length,
	};
}

export function publishVirtualListMountedCellsParity<
	TCell,
	TMountedCell extends MountedVirtualCell,
	TMountedBuild extends MountedVirtualCellsBuild<TMountedCell>,
>(params: {
	name: string | undefined;
	snapshot:
		| VirtualListSnapshot<TCell, TMountedCell, TMountedBuild>
		| null
		| undefined;
	renderedCells: readonly TMountedCell[];
	target?: VirtualListDebugState;
}): void {
	if (!params.name || !params.snapshot) {
		return;
	}

	const target = params.target ?? resolveWindowDebugTarget();
	if (!target) {
		return;
	}

	target.virtualLists ??= {};
	const debugSnapshot =
		target.virtualLists[params.name] ??
		createVirtualListDebugSnapshot(params.snapshot);
	debugSnapshot.mountedCellsParity = createVirtualListMountedCellsParity(
		params.snapshot,
		params.renderedCells,
	);
	target.virtualLists[params.name] = debugSnapshot;
}

export function isVirtualListDebugEnabled(): boolean {
	return typeof window !== "undefined" && !!window.__CCL_DEBUG__;
}

function resolveWindowDebugTarget(): VirtualListDebugState | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}

	if (window.__CCL_DEBUG__) {
		return window.__CCL_DEBUG__;
	}

	return undefined;
}
