import { describe, expect, it } from "vitest";
import {
	createVirtualizedItemVisibilityStateController,
	resolveVirtualizedItemVisibilityForPreviewRange,
	type VirtualizedItemResolvedVisibilityState,
} from "../virtualizedItemVisibilityState.svelte";
import type { RowRange } from "../../rowRange";

type TestCell = {
	key: string;
	stateKey?: string;
	cell: { kind: string };
};

const item = (key: string, stateKey?: string): TestCell => ({
	key,
	stateKey,
	cell: { kind: "item" },
});

const header = (key: string): TestCell => ({
	key,
	cell: { kind: "header" },
});

const row = (rowIndex: number, cells: TestCell[]) => ({
	rowIndex,
	cells,
});

const range = (start: number, end: number): RowRange => ({ start, end });

const getStateForPreviewRange = (
	ctrl: ReturnType<typeof createVirtualizedItemVisibilityStateController<TestCell>>,
	cell: TestCell,
	rowIndex: number,
	previewVisible: RowRange,
): VirtualizedItemResolvedVisibilityState =>
	ctrl.getOrCreateState(
		cell,
		resolveVirtualizedItemVisibilityForPreviewRange(rowIndex, previewVisible),
	);

describe("resolveVirtualizedItemVisibilityForPreviewRange", () => {
	it("returns visible when rowIndex is within preview range", () => {
		expect(resolveVirtualizedItemVisibilityForPreviewRange(2, range(1, 5))).toBe(
			"visible",
		);
	});

	it("returns mounted when rowIndex is outside preview range", () => {
		expect(resolveVirtualizedItemVisibilityForPreviewRange(0, range(1, 5))).toBe(
			"mounted",
		);
	});

	it("returns mounted when rowIndex is undefined", () => {
		expect(
			resolveVirtualizedItemVisibilityForPreviewRange(undefined, range(0, 5)),
		).toBe("mounted");
	});

	it("returns mounted when rowIndex equals range end (exclusive)", () => {
		expect(resolveVirtualizedItemVisibilityForPreviewRange(5, range(1, 5))).toBe(
			"mounted",
		);
	});
});

describe("createVirtualizedItemVisibilityStateController", () => {
	it("creates state with initial visibility on first getOrCreateState", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cell = item("a");
		const state = ctrl.getOrCreateState(cell, "mounted");

		expect(state.visibility).toBe("mounted");
	});

	it("returns same state reference for same cell key", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cell1 = item("a");
		const cell2 = item("a");

		const state1 = ctrl.getOrCreateState(cell1, "mounted");
		const state2 = ctrl.getOrCreateState(cell2, "visible");

		expect(state1).toBe(state2);
	});

	it("can resolve state identity from a caller-provided key", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>({
			getStateKey: (cell) => cell.stateKey ?? cell.key,
		});
		const cell1 = item("a", "slot:0");
		const cell2 = item("b", "slot:0");

		const state1 = ctrl.getOrCreateState(cell1, "mounted");
		const state2 = ctrl.getOrCreateState(cell2, "visible");

		expect(state2).toBe(state1);
		expect(state2.visibility).toBe("mounted");
	});

	it("emits item visibility by caller-provided key without clearing reused slots", () => {
		const visibilityChanges: Array<[string, string]> = [];
		const clearedKeys: string[] = [];
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>({
			getStateKey: (cell) => cell.stateKey ?? cell.key,
			onItemVisibilityChanged: (key, visibility) => {
				visibilityChanges.push([key, visibility]);
			},
			onItemCleared: (key) => {
				clearedKeys.push(key);
			},
		});

		ctrl.syncMountedRows({
			mountedRows: [row(10, [item("a", "slot:0")])],
			previewRange: range(10, 11),
		});
		ctrl.syncMountedRows({
			mountedRows: [row(20, [item("b", "slot:0")])],
			previewRange: range(20, 21),
		});

		expect(visibilityChanges).toEqual([["slot:0", "visible"]]);
		expect(clearedKeys).toEqual([]);

		ctrl.syncMountedRows({
			mountedRows: [],
			previewRange: range(0, 0),
		});

		expect(clearedKeys).toEqual(["slot:0"]);
	});

	it("path 1: no-op when rowSlices and previewVisible are identical", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = [item("a"), item("b")];
		const rows = [row(0, cells)];
		const r = range(0, 1);

		ctrl.sync(rows, r);
		const stateA = getStateForPreviewRange(ctrl, cells[0], 0, r);
		const stateB = getStateForPreviewRange(ctrl, cells[1], 0, r);

		expect(stateA.visibility).toBe("visible");
		expect(stateB.visibility).toBe("visible");

		ctrl.sync(rows, r);

		expect(stateA.visibility).toBe("visible");
		expect(stateB.visibility).toBe("visible");
	});

	it("path 2: delta update when only previewVisible changes on same rowSlices", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cellsA = [item("a"), item("b"), item("c")];
		const cellsB = [item("d"), item("e"), item("f")];
		const rows = [row(0, cellsA), row(1, cellsB)];

		ctrl.sync(rows, range(0, 1));

		const stateA = getStateForPreviewRange(ctrl, cellsA[0], 0, range(0, 1));
		const stateB = getStateForPreviewRange(ctrl, cellsA[1], 0, range(0, 1));
		const stateC = getStateForPreviewRange(ctrl, cellsA[2], 0, range(0, 1));
		const stateD = getStateForPreviewRange(ctrl, cellsB[0], 1, range(0, 1));
		const stateE = getStateForPreviewRange(ctrl, cellsB[1], 1, range(0, 1));
		const stateF = getStateForPreviewRange(ctrl, cellsB[2], 1, range(0, 1));

		expect(stateA.visibility).toBe("visible");
		expect(stateB.visibility).toBe("visible");
		expect(stateC.visibility).toBe("visible");
		expect(stateD.visibility).toBe("mounted");
		expect(stateE.visibility).toBe("mounted");
		expect(stateF.visibility).toBe("mounted");

		ctrl.sync(rows, range(1, 2));

		expect(stateA.visibility).toBe("mounted");
		expect(stateB.visibility).toBe("mounted");
		expect(stateC.visibility).toBe("mounted");
		expect(stateD.visibility).toBe("visible");
		expect(stateE.visibility).toBe("visible");
		expect(stateF.visibility).toBe("visible");
	});

	it("path 2: expanding preview range touches only new rows", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cellsA = [item("a")];
		const cellsB = [item("b")];
		const cellsC = [item("c")];
		const rows = [row(0, cellsA), row(1, cellsB), row(2, cellsC)];

		ctrl.sync(rows, range(1, 2));

		const stateA = getStateForPreviewRange(ctrl, cellsA[0], 0, range(1, 2));
		const stateB = getStateForPreviewRange(ctrl, cellsB[0], 1, range(1, 2));
		const stateC = getStateForPreviewRange(ctrl, cellsC[0], 2, range(1, 2));

		expect(stateA.visibility).toBe("mounted");
		expect(stateB.visibility).toBe("visible");
		expect(stateC.visibility).toBe("mounted");

		ctrl.sync(rows, range(0, 2));

		expect(stateA.visibility).toBe("visible");
		expect(stateB.visibility).toBe("visible");
		expect(stateC.visibility).toBe("mounted");
	});

	it("syncPreviewRangeDelta does not scan unchanged mounted rows", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = [item("a"), item("b"), item("c")];
		const untouchedRow = row(2, [cells[2]]);
		const rows = [row(0, [cells[0]]), row(1, [cells[1]]), untouchedRow];

		ctrl.syncMountedRows({
			mountedRows: rows,
			previewRange: range(0, 1),
		});
		const stateA = getStateForPreviewRange(ctrl, cells[0], 0, range(0, 1));
		const stateB = getStateForPreviewRange(ctrl, cells[1], 1, range(0, 1));

		Object.defineProperty(untouchedRow, "cells", {
			get(): never {
				throw new Error("Unchanged mounted row was scanned.");
			},
		});

		ctrl.syncPreviewRangeDelta({
			previousPreviewRange: range(0, 1),
			nextPreviewRange: range(1, 2),
			mountedRows: rows,
		});

		expect(stateA.visibility).toBe("mounted");
		expect(stateB.visibility).toBe("visible");
	});

	it("syncMountedRowRangeDelta scans only removed and added rows", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = [item("a"), item("b"), item("c"), item("d")];
		const keptRowB = row(1, [cells[1]]);
		const keptRowC = row(2, [cells[2]]);
		const previousRows = [row(0, [cells[0]]), keptRowB, keptRowC];
		const nextRows = [keptRowB, keptRowC, row(3, [cells[3]])];

		ctrl.syncMountedRows({
			mountedRows: previousRows,
			previewRange: range(1, 3),
		});
		const stateA = getStateForPreviewRange(ctrl, cells[0], 0, range(1, 3));
		const stateD = ctrl.getOrCreateState(cells[3], "mounted");

		for (const keptRow of [keptRowB, keptRowC]) {
			Object.defineProperty(keptRow, "cells", {
				get(): never {
					throw new Error("Kept mounted row was scanned.");
				},
			});
		}

		ctrl.syncMountedRowRangeDelta({
			previousRows,
			nextRows,
			previousRowRange: range(0, 3),
			nextRowRange: range(1, 4),
			previewRange: range(1, 4),
		});

		expect(stateD.visibility).toBe("visible");
		expect(ctrl.getOrCreateState(cells[0], "mounted")).not.toBe(stateA);
	});

	it("syncMountedRowRangeDelta retains state for a key moving between delta rows", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const previousCell = item("a");
		const nextCell = item("a");
		const keptRow = row(1, [item("b")]);
		const previousRows = [row(0, [previousCell]), keptRow];
		const nextRows = [keptRow, row(2, [nextCell])];

		ctrl.syncMountedRows({
			mountedRows: previousRows,
			previewRange: range(0, 1),
		});
		const state = getStateForPreviewRange(ctrl, previousCell, 0, range(0, 1));

		ctrl.syncMountedRowRangeDelta({
			previousRows,
			nextRows,
			previousRowRange: range(0, 2),
			nextRowRange: range(1, 3),
			previewRange: range(2, 3),
		});

		expect(ctrl.getOrCreateState(nextCell, "mounted")).toBe(state);
		expect(state.visibility).toBe("visible");
	});

	it("syncMountedRowRangeDelta falls back before mutating on invalid delta rows", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const previousCell = item("a");
		const nextCell = item("a");
		const keptRow = row(1, [item("b")]);
		const previousRows = [row(0, [previousCell]), keptRow];
		const nextRows = [keptRow, row(99, [nextCell])];

		ctrl.syncMountedRows({
			mountedRows: previousRows,
			previewRange: range(0, 1),
		});
		const state = getStateForPreviewRange(ctrl, previousCell, 0, range(0, 1));

		ctrl.syncMountedRowRangeDelta({
			previousRows,
			nextRows,
			previousRowRange: range(0, 2),
			nextRowRange: range(1, 3),
			previewRange: range(99, 100),
		});

		expect(ctrl.getOrCreateState(nextCell, "mounted")).toBe(state);
		expect(state.visibility).toBe("visible");
	});

	it("path 3: full scan when rowSlices reference changes", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells1 = [item("a"), item("b")];
		const rows1 = [row(0, cells1)];

		ctrl.sync(rows1, range(0, 2));

		const stateA = getStateForPreviewRange(ctrl, cells1[0], 0, range(0, 2));
		const stateB = getStateForPreviewRange(ctrl, cells1[1], 0, range(0, 2));

		expect(stateA.visibility).toBe("visible");
		expect(stateB.visibility).toBe("visible");

		const cells2 = [item("c"), item("d")];
		const rows2 = [row(2, [cells2[0]]), row(3, [cells2[1]])];

		ctrl.sync(rows2, range(2, 3));

		const stateC = getStateForPreviewRange(ctrl, cells2[0], 2, range(2, 3));
		const stateD = ctrl.getOrCreateState(cells2[1], "mounted");

		expect(stateC.visibility).toBe("visible");
		expect(stateD.visibility).toBe("mounted");
	});

	it("path 3: stale pruning removes unmounted states", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();

		const cells1 = [item("a"), item("b")];
		ctrl.sync([row(0, cells1)], range(0, 1));

		const stateA = getStateForPreviewRange(ctrl, cells1[0], 0, range(0, 1));
		expect(stateA.visibility).toBe("visible");

		const cells2 = [item("c")];
		ctrl.sync([row(0, cells2)], range(0, 1));

		const stateC = getStateForPreviewRange(ctrl, cells2[0], 0, range(0, 1));
		expect(stateC.visibility).toBe("visible");

		const orphanedState = ctrl.getOrCreateState(cells1[0], "mounted");
		expect(orphanedState).not.toBe(stateA);
		expect(orphanedState.visibility).toBe("mounted");
	});

	it("skips non-item cells", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = [item("a"), header("h1"), item("b")];
		const rows = [row(0, cells)];

		ctrl.sync(rows, range(0, 2));

		const stateA = getStateForPreviewRange(ctrl, cells[0], 0, range(0, 2));
		const stateB = getStateForPreviewRange(ctrl, cells[2], 0, range(0, 2));

		expect(stateA.visibility).toBe("visible");
		expect(stateB.visibility).toBe("visible");
	});

	it("does not create state for header cells during sync", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = [header("h1")];
		const rows = [row(0, cells)];

		ctrl.sync(rows, range(0, 1));

		const stateH = ctrl.getOrCreateState(cells[0], "mounted");
		expect(stateH.visibility).toBe("mounted");
	});

	it("does not create state for item cells during sync", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cell = item("a");

		ctrl.sync([row(0, [cell])], range(0, 1));

		const state = ctrl.getOrCreateState(cell, "mounted");
		expect(state.visibility).toBe("mounted");
	});

	it("path 2: handles non-overlapping forward preview jumps", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = Array.from({ length: 30 }, (_, index) => item(String(index)));
		const rows = cells.map((cell, index) => row(index, [cell]));

		ctrl.sync(rows, range(0, 10));

		const states = cells.map((cell, index) =>
			getStateForPreviewRange(ctrl, cell, index, range(0, 10)),
		);

		ctrl.sync(rows, range(20, 30));

		for (let i = 0; i < 20; i++) {
			expect(states[i].visibility).toBe("mounted");
		}
		for (let i = 20; i < 30; i++) {
			expect(states[i].visibility).toBe("visible");
		}
	});

	it("path 2: handles non-overlapping backward preview jumps", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = Array.from({ length: 30 }, (_, index) => item(String(index)));
		const rows = cells.map((cell, index) => row(index, [cell]));

		ctrl.sync(rows, range(20, 30));

		const states = cells.map((cell, index) =>
			getStateForPreviewRange(ctrl, cell, index, range(20, 30)),
		);

		ctrl.sync(rows, range(0, 10));

		for (let i = 0; i < 10; i++) {
			expect(states[i].visibility).toBe("visible");
		}
		for (let i = 10; i < 30; i++) {
			expect(states[i].visibility).toBe("mounted");
		}
	});

	it("path 2: shrinks range from both ends", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = Array.from({ length: 20 }, (_, index) => item(String(index)));
		const rows = cells.map((cell, index) => row(index, [cell]));

		ctrl.sync(rows, range(0, 20));

		const states = cells.map((cell, index) =>
			getStateForPreviewRange(ctrl, cell, index, range(0, 20)),
		);

		ctrl.sync(rows, range(5, 15));

		for (let i = 0; i < 5; i++) {
			expect(states[i].visibility).toBe("mounted");
		}
		for (let i = 5; i < 15; i++) {
			expect(states[i].visibility).toBe("visible");
		}
		for (let i = 15; i < 20; i++) {
			expect(states[i].visibility).toBe("mounted");
		}
	});

	it("path 2: partial overlap on both sides", () => {
		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>();
		const cells = Array.from({ length: 30 }, (_, index) => item(String(index)));
		const rows = cells.map((cell, index) => row(index, [cell]));

		ctrl.sync(rows, range(5, 25));

		const states = cells.map((cell, index) =>
			getStateForPreviewRange(ctrl, cell, index, range(5, 25)),
		);

		ctrl.sync(rows, range(10, 30));

		for (let i = 0; i < 10; i++) {
			expect(states[i].visibility).toBe("mounted");
		}
		for (let i = 10; i < 30; i++) {
			expect(states[i].visibility).toBe("visible");
		}
	});

	it("only emits onRowVisibilityChanged when row visibility transitions", () => {
		const visibilityChanges: Array<[number, string]> = [];

		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>({
			onRowVisibilityChanged: (rowIndex, visibility) => {
				visibilityChanges.push([rowIndex, visibility]);
			},
		});

		const cells = [item("a")];
		const rows = [row(0, cells)];

		ctrl.sync(rows, range(0, 1));
		expect(visibilityChanges).toEqual([[0, "visible"]]);

		ctrl.sync(rows, range(0, 1));
		expect(visibilityChanges).toEqual([[0, "visible"]]);

		ctrl.sync(rows, range(1, 2));
		expect(visibilityChanges).toEqual([
			[0, "visible"],
			[0, "mounted"],
		]);
	});

	it("does not clear retained rows during a full mounted-rows sync", () => {
		const clearedRows: number[] = [];
		const visibilityChanges: Array<[number, string]> = [];

		const ctrl = createVirtualizedItemVisibilityStateController<TestCell>({
			onRowCleared: (rowIndex) => {
				clearedRows.push(rowIndex);
			},
			onRowVisibilityChanged: (rowIndex, visibility) => {
				visibilityChanges.push([rowIndex, visibility]);
			},
		});

		const firstCell = item("a");
		const firstRows = [row(0, [firstCell])];

		ctrl.syncMountedRows({
			mountedRows: firstRows,
			previewRange: range(0, 1),
		});

		const secondCell = item("a");
		const secondRows = [row(0, [secondCell])];

		ctrl.syncMountedRows({
			mountedRows: secondRows,
			previewRange: range(0, 1),
		});

		expect(clearedRows).toEqual([]);
	});
});
