import type {
	VirtualizedItemVisibility,
	VirtualizedItemVisibilityState,
} from "../../virtualizedItemVisibility";
import { sameRange, type RowRange } from "../rowRange";

interface VisibilityCell {
	readonly key: string;
	readonly cell: {
		readonly kind: string;
	};
}

export interface VisibilityRow<TCell extends VisibilityCell> {
	readonly rowIndex: number;
	readonly cells: readonly TCell[];
}

export interface VirtualizedItemResolvedVisibilityState extends VirtualizedItemVisibilityState {
	readonly visibility: VirtualizedItemVisibility;
}

interface MutableVisibilityState {
	visibility: VirtualizedItemVisibility;
}

export interface RowVisibilityDelta {
	readonly activatedRows: readonly number[];
	readonly deactivatedRows: readonly number[];
	readonly clearedRows: readonly number[];
}

export interface VirtualCardDisplaySnapshot<TCell extends VisibilityCell> {
	readonly rowModelRevision: unknown;
	readonly mountedRows: readonly VisibilityRow<TCell>[];
	readonly mountedRange: RowRange;
	readonly previewActiveRange: RowRange;
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

export interface VirtualizedItemVisibilityStateControllerOptions<
	TCell extends VisibilityCell = VisibilityCell,
> {
	readonly getStateKey?: (cell: TCell) => string;
	readonly onRowVisibilityChanged?: (
		rowIndex: number,
		visibility: VirtualizedItemVisibility,
	) => void;
	readonly onRowCleared?: (rowIndex: number) => void;
	/** Receives one notification after all internal maps and states are committed. */
	readonly onVisibilityDelta?: (delta: RowVisibilityDelta) => void;
}

export function createVirtualizedItemVisibilityStateController<
	TCell extends VisibilityCell,
>(options: VirtualizedItemVisibilityStateControllerOptions<TCell> = {}) {
	interface TrackedState {
		readonly state: VirtualizedItemResolvedVisibilityState;
		readonly mutableState: MutableVisibilityState;
		seenEpoch: number;
	}

	let epoch = 0;
	const states = new Map<string, TrackedState>();
	let previousRowSlices: readonly VisibilityRow<TCell>[] | undefined;
	const previousPreviewVisible: RowRange = { start: 0, end: 0 };
	let hasPreviousPreviewVisible = false;
	let rowsByIndex = new Map<number, VisibilityRow<TCell>>();
	const mountedItemKeyCounts = new Map<string, number>();
	const rowVisibilityByIndex = new Map<number, VirtualizedItemVisibility>();
	const nextRowIndicesScratch = new Set<number>();
	const activatedRowsScratch = new Set<number>();
	const deactivatedRowsScratch = new Set<number>();
	const clearedRowsScratch = new Set<number>();
	let visibilityCommitDepth = 0;
	let committedRowModelRevision: unknown;
	let hasCommittedSnapshot = false;
	let committedMountedRows: readonly VisibilityRow<TCell>[] = [];
	const committedMountedRange: RowRange = { start: 0, end: 0 };
	const getStateKey = options.getStateKey ?? ((cell: TCell) => cell.key);

	const flushVisibilityDelta = (): void => {
		if (
			activatedRowsScratch.size === 0 &&
			deactivatedRowsScratch.size === 0 &&
			clearedRowsScratch.size === 0
		) {
			return;
		}

		const delta: RowVisibilityDelta = {
			activatedRows: Array.from(activatedRowsScratch),
			deactivatedRows: Array.from(deactivatedRowsScratch),
			clearedRows: Array.from(clearedRowsScratch),
		};
		activatedRowsScratch.clear();
		deactivatedRowsScratch.clear();
		clearedRowsScratch.clear();

		options.onVisibilityDelta?.(delta);
		for (const rowIndex of delta.activatedRows) {
			options.onRowVisibilityChanged?.(rowIndex, "visible");
		}
		for (const rowIndex of delta.deactivatedRows) {
			options.onRowVisibilityChanged?.(rowIndex, "mounted");
		}
		for (const rowIndex of delta.clearedRows) {
			options.onRowCleared?.(rowIndex);
		}
	};

	const runVisibilityCommit = (commit: () => void): void => {
		visibilityCommitDepth += 1;
		try {
			commit();
		} finally {
			visibilityCommitDepth -= 1;
			if (visibilityCommitDepth === 0) {
				flushVisibilityDelta();
			}
		}
	};

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

			const key = getStateKey(cell);
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

			const key = getStateKey(cell);
			if (!mountedItemKeyCounts.has(key)) {
				states.delete(key);
			}
		}
	};

	const getOrCreateState = (
		cell: TCell,
		initialVisibility: VirtualizedItemVisibility,
	): VirtualizedItemResolvedVisibilityState => {
		const key = getStateKey(cell);
		const existing = states.get(key);
		if (existing) {
			return existing.state;
		}

		const mutableState: MutableVisibilityState = $state({
			visibility: initialVisibility,
		});
		const state: VirtualizedItemResolvedVisibilityState = mutableState;
		const tracked: TrackedState = { state, mutableState, seenEpoch: 0 };
		states.set(key, tracked);
		return state;
	};

	const notifyRowVisibilityIfChanged = (
		rowIndex: number,
		nextVisibility: VirtualizedItemVisibility,
	): void => {
		const previous = rowVisibilityByIndex.get(rowIndex);
		if (previous === nextVisibility) {
			return;
		}

		rowVisibilityByIndex.set(rowIndex, nextVisibility);
		clearedRowsScratch.delete(rowIndex);
		if (nextVisibility === "visible") {
			deactivatedRowsScratch.delete(rowIndex);
			activatedRowsScratch.add(rowIndex);
			return;
		}

		activatedRowsScratch.delete(rowIndex);
		deactivatedRowsScratch.add(rowIndex);
	};

	const notifyRowCleared = (rowIndex: number): void => {
		rowVisibilityByIndex.delete(rowIndex);
		activatedRowsScratch.delete(rowIndex);
		deactivatedRowsScratch.delete(rowIndex);
		clearedRowsScratch.add(rowIndex);
	};

	const applyVisibilityToRow = (
		row: VisibilityRow<TCell>,
		nextVisibility: VirtualizedItemVisibility,
	): void => {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "item") {
				continue;
			}

			const key = getStateKey(cell);
			const tracked = states.get(key);
			if (!tracked) {
				continue;
			}

			if (tracked.mutableState.visibility !== nextVisibility) {
				tracked.mutableState.visibility = nextVisibility;
			}
		}

		notifyRowVisibilityIfChanged(row.rowIndex, nextVisibility);
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

	const syncPreviewVisibleDelta = (oldRange: RowRange, newRange: RowRange): void => {
		const { start: oldStart, end: oldEnd } = oldRange;
		const { start: newStart, end: newEnd } = newRange;

		if (oldStart < newStart) {
			applyVisibilityToRowRange(oldStart, Math.min(oldEnd, newStart), "mounted");
		}
		if (newEnd < oldEnd) {
			applyVisibilityToRowRange(Math.max(oldStart, newEnd), oldEnd, "mounted");
		}

		if (newStart < oldStart) {
			applyVisibilityToRowRange(newStart, Math.min(newEnd, oldStart), "visible");
		}
		if (oldEnd < newEnd) {
			applyVisibilityToRowRange(Math.max(newStart, oldEnd), newEnd, "visible");
		}
	};

	const syncAllMountedRows = (
		rowSlices: readonly VisibilityRow<TCell>[],
		previewVisible: RowRange,
	): void => {
		nextRowIndicesScratch.clear();
		for (const row of rowSlices) {
			nextRowIndicesScratch.add(row.rowIndex);
		}

		for (const rowIndex of rowsByIndex.keys()) {
			if (!nextRowIndicesScratch.has(rowIndex)) {
				notifyRowCleared(rowIndex);
			}
		}
		nextRowIndicesScratch.clear();

		mountedItemKeyCounts.clear();
		for (const row of rowSlices) {
			const nextVisibility = resolveVirtualizedItemVisibilityForPreviewRange(
				row.rowIndex,
				previewVisible,
			);

			for (const cell of row.cells) {
				if (cell.cell.kind !== "item") {
					continue;
				}

				const key = getStateKey(cell);
				mountedItemKeyCounts.set(key, (mountedItemKeyCounts.get(key) ?? 0) + 1);
				const tracked = states.get(key);
				if (!tracked) {
					continue;
				}

				tracked.seenEpoch = epoch;
				if (tracked.mutableState.visibility !== nextVisibility) {
					tracked.mutableState.visibility = nextVisibility;
				}
			}
			notifyRowVisibilityIfChanged(row.rowIndex, nextVisibility);
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
		rowVisibilityByIndex.delete(row.rowIndex);
		notifyRowCleared(row.rowIndex);
	};

	const addMountedRow = (row: VisibilityRow<TCell>, previewRange: RowRange): void => {
		rowsByIndex.set(row.rowIndex, row);
		updateMountedItemKeyCount(row, 1);
		applyVisibilityToRow(
			row,
			resolveVirtualizedItemVisibilityForPreviewRange(row.rowIndex, previewRange),
		);
	};

	const forEachDeltaRow = (
		rows: readonly VisibilityRow<TCell>[],
		rowRange: RowRange,
		start: number,
		end: number,
		previewRange: RowRange,
		visitRow?: (row: VisibilityRow<TCell>, previewRange: RowRange) => void,
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

	const syncMountedRowsInternal = (params: {
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

	const syncMountedRowRangeDeltaInternal = (params: {
		previousRows: readonly VisibilityRow<TCell>[];
		nextRows: readonly VisibilityRow<TCell>[];
		previousRowRange: RowRange;
		nextRowRange: RowRange;
		previewRange: RowRange;
	}): void => {
		const { previousRows, nextRows, previousRowRange, nextRowRange, previewRange } =
			params;
		if (previousRows !== previousRowSlices || !hasPreviousPreviewVisible) {
			syncMountedRowsInternal({
				mountedRows: nextRows,
				previewRange,
			});
			return;
		}

		const removedLeadingEnd = Math.min(previousRowRange.end, nextRowRange.start);
		const removedTrailingStart = Math.max(previousRowRange.start, nextRowRange.end);
		const addedLeadingEnd = Math.min(nextRowRange.end, previousRowRange.start);
		const addedTrailingStart = Math.max(nextRowRange.start, previousRowRange.end);
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
			syncMountedRowsInternal({ mountedRows: nextRows, previewRange });
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

	const syncPreviewRangeDeltaInternal = (params: {
		previousPreviewRange: RowRange;
		nextPreviewRange: RowRange;
		mountedRows: readonly VisibilityRow<TCell>[];
	}): void => {
		const { previousPreviewRange, nextPreviewRange, mountedRows } = params;

		if (
			mountedRows !== previousRowSlices ||
			!hasPreviousPreviewVisible ||
			!sameRange(previousPreviewRange, previousPreviewVisible)
		) {
			syncMountedRowsInternal({
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

	const syncInternal = (
		mountedRows: readonly VisibilityRow<TCell>[],
		previewRange: RowRange,
	): void => {
		if (!hasPreviousPreviewVisible || mountedRows !== previousRowSlices) {
			syncMountedRowsInternal({ mountedRows, previewRange });
			return;
		}

		syncPreviewRangeDeltaInternal({
			previousPreviewRange: previousPreviewVisible,
			nextPreviewRange: previewRange,
			mountedRows,
		});
	};

	const syncMountedRows = (
		params: Parameters<typeof syncMountedRowsInternal>[0],
	): void => runVisibilityCommit(() => syncMountedRowsInternal(params));

	const syncMountedRowRangeDelta = (
		params: Parameters<typeof syncMountedRowRangeDeltaInternal>[0],
	): void => runVisibilityCommit(() => syncMountedRowRangeDeltaInternal(params));

	const syncPreviewRangeDelta = (
		params: Parameters<typeof syncPreviewRangeDeltaInternal>[0],
	): void => runVisibilityCommit(() => syncPreviewRangeDeltaInternal(params));

	const sync = (
		mountedRows: readonly VisibilityRow<TCell>[],
		previewRange: RowRange,
	): void => runVisibilityCommit(() => syncInternal(mountedRows, previewRange));

	const commit = (snapshot: VirtualCardDisplaySnapshot<TCell>): void => {
		runVisibilityCommit(() => {
			if (
				!hasCommittedSnapshot ||
				snapshot.rowModelRevision !== committedRowModelRevision
			) {
				syncMountedRowsInternal({
					mountedRows: snapshot.mountedRows,
					previewRange: snapshot.previewActiveRange,
				});
			} else if (snapshot.mountedRows !== committedMountedRows) {
				syncMountedRowRangeDeltaInternal({
					previousRows: committedMountedRows,
					nextRows: snapshot.mountedRows,
					previousRowRange: committedMountedRange,
					nextRowRange: snapshot.mountedRange,
					previewRange: snapshot.previewActiveRange,
				});
			} else {
				syncPreviewRangeDeltaInternal({
					previousPreviewRange: previousPreviewVisible,
					nextPreviewRange: snapshot.previewActiveRange,
					mountedRows: snapshot.mountedRows,
				});
			}

			committedRowModelRevision = snapshot.rowModelRevision;
			committedMountedRows = snapshot.mountedRows;
			committedMountedRange.start = snapshot.mountedRange.start;
			committedMountedRange.end = snapshot.mountedRange.end;
			hasCommittedSnapshot = true;
		});
	};

	return {
		getOrCreateState,
		commit,
		getCommittedMountedRows: () => committedMountedRows,
		getCommittedMountedRange: () => committedMountedRange,
		getCommittedRowModelRevision: () =>
			hasCommittedSnapshot ? committedRowModelRevision : null,
		syncMountedRows,
		syncMountedRowRangeDelta,
		syncPreviewRangeDelta,
		sync,
	};
}
