import type {
	VirtualizedItemVisibility,
	VirtualizedItemVisibilityState,
} from "../../virtualizedItemVisibility";
import { sameRange, type RowRange } from "../rowRange";

interface VisibilityCell {
	readonly key: unknown;
	readonly cell: {
		readonly kind: string;
	};
}

interface VisibilityRow<TCell extends VisibilityCell> {
	readonly rowIndex: number;
	readonly cells: readonly TCell[];
}

export interface VirtualizedItemResolvedVisibilityState
	extends VirtualizedItemVisibilityState {
	visibility: VirtualizedItemVisibility;
}

export const resolveVirtualizedItemVisibilityForPreviewRange = (
	rowIndex: number | undefined,
	previewVisible: RowRange,
): VirtualizedItemVisibility => {
	if (
		rowIndex !== undefined &&
		rowIndex >= previewVisible.start &&
		rowIndex < previewVisible.end
	) {
		return "visible";
	}

	return "mounted";
};

export function createVirtualizedItemVisibilityStateController<
	TCell extends VisibilityCell,
>() {
	interface TrackedState {
		readonly state: VirtualizedItemResolvedVisibilityState;
		seenEpoch: number;
	}

	let epoch = 0;
	const states = new Map<string, TrackedState>();
	let previousRowSlices: readonly VisibilityRow<TCell>[] | undefined;
	const previousPreviewVisible: RowRange = { start: 0, end: 0 };
	let hasPreviousPreviewVisible = false;
	let rowsByIndex = new Map<number, VisibilityRow<TCell>>();
	const mountedItemKeyCounts = new Map<string, number>();

	const rememberPreviousPreviewVisible = (previewRange: RowRange): void => {
		previousPreviewVisible.start = previewRange.start;
		previousPreviewVisible.end = previewRange.end;
		hasPreviousPreviewVisible = true;
	};

	const rebuildRowsByIndex = (rowSlices: readonly VisibilityRow<TCell>[]) => {
		rowsByIndex.clear();
		for (const row of rowSlices) {
			rowsByIndex.set(row.rowIndex, row);
		}
	};

	const updateMountedItemKeyCount = (
		row: VisibilityRow<TCell>,
		delta: 1 | -1,
	): void => {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "item") {
				continue;
			}

			const key = String(cell.key);
			const nextCount = (mountedItemKeyCounts.get(key) ?? 0) + delta;
			if (nextCount > 0) {
				mountedItemKeyCounts.set(key, nextCount);
			} else {
				mountedItemKeyCounts.delete(key);
			}
		}
	};

	const pruneUnmountedRowState = (row: VisibilityRow<TCell>): void => {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "item") {
				continue;
			}

			const key = String(cell.key);
			if (!mountedItemKeyCounts.has(key)) {
				states.delete(key);
			}
		}
	};

	const getOrCreateState = (
		cell: TCell,
		initialVisibility: VirtualizedItemVisibility,
	): VirtualizedItemResolvedVisibilityState => {
		const key = String(cell.key);
		const existing = states.get(key);
		if (existing) {
			return existing.state;
		}

		const state: VirtualizedItemResolvedVisibilityState = $state({
			visibility: initialVisibility,
		});
		const tracked: TrackedState = { state, seenEpoch: 0 };
		states.set(key, tracked);
		return state;
	};

	const applyVisibilityToRow = (
		row: VisibilityRow<TCell>,
		nextVisibility: VirtualizedItemVisibility,
	): void => {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "item") {
				continue;
			}

			const key = String(cell.key);
			const tracked = states.get(key);
			if (!tracked) {
				continue;
			}

			if (tracked.state.visibility !== nextVisibility) {
				tracked.state.visibility = nextVisibility;
			}
		}
	};

	const applyVisibilityToRowRange = (
		start: number,
		end: number,
		visibility: VirtualizedItemVisibility,
	): void => {
		for (let r = start; r < end; r++) {
			const row = rowsByIndex.get(r);
			if (row) {
				applyVisibilityToRow(row, visibility);
			}
		}
	};

	const syncPreviewVisibleDelta = (
		oldRange: RowRange,
		newRange: RowRange,
	): void => {
		const { start: oldStart, end: oldEnd } = oldRange;
		const { start: newStart, end: newEnd } = newRange;

		if (oldStart < newStart) {
			applyVisibilityToRowRange(
				oldStart,
				Math.min(oldEnd, newStart),
				"mounted",
			);
		}
		if (newEnd < oldEnd) {
			applyVisibilityToRowRange(
				Math.max(oldStart, newEnd),
				oldEnd,
				"mounted",
			);
		}

		if (newStart < oldStart) {
			applyVisibilityToRowRange(
				newStart,
				Math.min(newEnd, oldStart),
				"visible",
			);
		}
		if (oldEnd < newEnd) {
			applyVisibilityToRowRange(
				Math.max(newStart, oldEnd),
				newEnd,
				"visible",
			);
		}
	};

	const syncAllMountedRows = (
		rowSlices: readonly VisibilityRow<TCell>[],
		previewVisible: RowRange,
	): void => {
		mountedItemKeyCounts.clear();
		for (const row of rowSlices) {
			const nextVisibility =
				resolveVirtualizedItemVisibilityForPreviewRange(
					row.rowIndex,
					previewVisible,
				);

			for (const cell of row.cells) {
				if (cell.cell.kind !== "item") {
					continue;
				}

				const key = String(cell.key);
				mountedItemKeyCounts.set(
					key,
					(mountedItemKeyCounts.get(key) ?? 0) + 1,
				);
				const tracked = states.get(key);
				if (!tracked) {
					continue;
				}

				tracked.seenEpoch = epoch;
				if (tracked.state.visibility !== nextVisibility) {
					tracked.state.visibility = nextVisibility;
				}
			}
		}

		for (const [key, tracked] of states) {
			if (tracked.seenEpoch !== epoch) {
				states.delete(key);
			}
		}
	};

	const getRow = (
		rows: readonly VisibilityRow<TCell>[],
		rowRange: RowRange,
		rowIndex: number,
	): VisibilityRow<TCell> | undefined => {
		const row = rows[rowIndex - rowRange.start];
		return row?.rowIndex === rowIndex ? row : undefined;
	};

	const removeMountedRow = (row: VisibilityRow<TCell>): void => {
		rowsByIndex.delete(row.rowIndex);
		updateMountedItemKeyCount(row, -1);
		pruneUnmountedRowState(row);
	};

	const addMountedRow = (
		row: VisibilityRow<TCell>,
		previewRange: RowRange,
	): void => {
		rowsByIndex.set(row.rowIndex, row);
		updateMountedItemKeyCount(row, 1);
		applyVisibilityToRow(
			row,
			resolveVirtualizedItemVisibilityForPreviewRange(
				row.rowIndex,
				previewRange,
			),
		);
	};

	const forEachDeltaRow = (
		rows: readonly VisibilityRow<TCell>[],
		rowRange: RowRange,
		start: number,
		end: number,
		previewRange: RowRange,
		visitRow?: (
			row: VisibilityRow<TCell>,
			previewRange: RowRange,
		) => void,
	): boolean => {
		for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
			const row = getRow(rows, rowRange, rowIndex);
			if (!row) {
				return false;
			}

			visitRow?.(row, previewRange);
		}
		return true;
	};

	const syncMountedRows = (params: {
		mountedRows: readonly VisibilityRow<TCell>[];
		previewRange: RowRange;
	}): void => {
		const { mountedRows, previewRange } = params;
		if (
			mountedRows === previousRowSlices &&
			hasPreviousPreviewVisible &&
			sameRange(previewRange, previousPreviewVisible)
		) {
			return;
		}

		previousRowSlices = mountedRows;
		rememberPreviousPreviewVisible(previewRange);
		epoch += 1;

		syncAllMountedRows(mountedRows, previewRange);
		rebuildRowsByIndex(mountedRows);
	};

	const syncMountedRowRangeDelta = (params: {
		previousRows: readonly VisibilityRow<TCell>[];
		nextRows: readonly VisibilityRow<TCell>[];
		previousRowRange: RowRange;
		nextRowRange: RowRange;
		previewRange: RowRange;
	}): void => {
		const {
			previousRows,
			nextRows,
			previousRowRange,
			nextRowRange,
			previewRange,
		} = params;
		if (
			previousRows !== previousRowSlices ||
			!hasPreviousPreviewVisible
		) {
			syncMountedRows({
				mountedRows: nextRows,
				previewRange,
			});
			return;
		}

		const removedLeadingEnd = Math.min(
			previousRowRange.end,
			nextRowRange.start,
		);
		const removedTrailingStart = Math.max(
			previousRowRange.start,
			nextRowRange.end,
		);
		const addedLeadingEnd = Math.min(
			nextRowRange.end,
			previousRowRange.start,
		);
		const addedTrailingStart = Math.max(
			nextRowRange.start,
			previousRowRange.end,
		);
		// Validate every range before mutating so fallback starts from intact state.
		const hasAllDeltaRows =
			forEachDeltaRow(
				previousRows,
				previousRowRange,
				previousRowRange.start,
				removedLeadingEnd,
				previewRange,
			) &&
			forEachDeltaRow(
				previousRows,
				previousRowRange,
				removedTrailingStart,
				previousRowRange.end,
				previewRange,
			) &&
			forEachDeltaRow(
				nextRows,
				nextRowRange,
				nextRowRange.start,
				addedLeadingEnd,
				previewRange,
			) &&
			forEachDeltaRow(
				nextRows,
				nextRowRange,
				addedTrailingStart,
				nextRowRange.end,
				previewRange,
			);
		if (!hasAllDeltaRows) {
			syncMountedRows({ mountedRows: nextRows, previewRange });
			return;
		}

		forEachDeltaRow(
			nextRows,
			nextRowRange,
			nextRowRange.start,
			addedLeadingEnd,
			previewRange,
			addMountedRow,
		);
		forEachDeltaRow(
			nextRows,
			nextRowRange,
			addedTrailingStart,
			nextRowRange.end,
			previewRange,
			addMountedRow,
		);
		forEachDeltaRow(
			previousRows,
			previousRowRange,
			previousRowRange.start,
			removedLeadingEnd,
			previewRange,
			removeMountedRow,
		);
		forEachDeltaRow(
			previousRows,
			previousRowRange,
			removedTrailingStart,
			previousRowRange.end,
			previewRange,
			removeMountedRow,
		);
		syncPreviewVisibleDelta(previousPreviewVisible, previewRange);

		previousRowSlices = nextRows;
		rememberPreviousPreviewVisible(previewRange);
	};

	const syncPreviewRangeDelta = (params: {
		previousPreviewRange: RowRange;
		nextPreviewRange: RowRange;
		mountedRows: readonly VisibilityRow<TCell>[];
	}): void => {
		const {
			previousPreviewRange,
			nextPreviewRange,
			mountedRows,
		} = params;

		if (
			mountedRows !== previousRowSlices ||
			!hasPreviousPreviewVisible ||
			!sameRange(previousPreviewRange, previousPreviewVisible)
		) {
			syncMountedRows({
				mountedRows,
				previewRange: nextPreviewRange,
			});
			return;
		}

		if (sameRange(previousPreviewRange, nextPreviewRange)) {
			return;
		}

		syncPreviewVisibleDelta(previousPreviewRange, nextPreviewRange);
		rememberPreviousPreviewVisible(nextPreviewRange);
	};

	const sync = (
		mountedRows: readonly VisibilityRow<TCell>[],
		previewRange: RowRange,
	): void => {
		if (!hasPreviousPreviewVisible || mountedRows !== previousRowSlices) {
			syncMountedRows({ mountedRows, previewRange });
			return;
		}

		syncPreviewRangeDelta({
			previousPreviewRange: previousPreviewVisible,
			nextPreviewRange: previewRange,
			mountedRows,
		});
	};

	return {
		getOrCreateState,
		syncMountedRows,
		syncMountedRowRangeDelta,
		syncPreviewRangeDelta,
		sync,
	};
}
