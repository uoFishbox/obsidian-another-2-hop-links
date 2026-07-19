import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	flushFrames,
	installAnimationFrameMock,
	teardownAnimationFrameMock,
} from "testing/helpers/DOMObserverMock";
import VirtualSurfaceRecyclingHarness from "./VirtualSurfaceRecyclingHarness.svelte";
import type { MountedVirtualCell, LogicalCellKey, RenderSlotKey } from "../../types";

// ---------------------------------------------------------------------------
// Test model: grid cells over a fixed row stride
// ---------------------------------------------------------------------------

interface TestMountedCell extends MountedVirtualCell {
	columnIndex: number;
	top: number;
	left: number;
	width: number;
	height: number;
}

interface TestRow {
	slotIndex: number;
	rowIndex: number;
	top: number;
	cells: TestMountedCell[];
}

const COLUMNS = 3;
const ROW_HEIGHT = 50;
const GAP = 12;
const ROW_STRIDE = ROW_HEIGHT + GAP; // 62
const CELL_WIDTH = 200;
const TOTAL_ITEMS = 10_000;
const MOUNTED_ROWS = 9; // 5 visible + 4 overscan (matches engine contract)

// ---------------------------------------------------------------------------
// Row-slot assignment model — mirrors the reconciliation in
// linkListVirtualLayout.ts
// ---------------------------------------------------------------------------

/**
 * Compute the `renderSlotKey` for a cell within a row.
 * Matches the engine: `rowSlotIndex * columns + columnIndex`.
 */
const cellSlotKey = (rowSlotIndex: number, columnIndex: number): number =>
	rowSlotIndex * COLUMNS + columnIndex;

/**
 * Build mounted cells for rows `[rowStart, rowStart + mountedRows)`,
 * assigning stable `slotIndex` values like the real reconciliation.
 *
 * `previousRows` is the previous frame's row array; rows that are still
 * present (retained) keep their `slotIndex`, while rows that left return
 * their `slotIndex` to a free pool that is given to entering rows.
 */
function buildRowCellsWithSlotReuse(
	rowStart: number,
	mountedRows: number,
	previousRows?: TestRow[],
): { cells: TestMountedCell[]; rows: TestRow[] } {
	const rows: TestRow[] = [];
	const cells: TestMountedCell[] = [];

	// Collect slots that were used in the previous frame
	const previousSlotByRow = new Map<number, number>();
	if (previousRows) {
		for (const row of previousRows) {
			previousSlotByRow.set(row.rowIndex, row.slotIndex);
		}
	}

	// Identify which slots are still used by retained rows and which are free
	const retainedSlots = new Set<number>();
	const allPreviousSlots = new Set<number>();
	if (previousRows) {
		for (const row of previousRows) {
			allPreviousSlots.add(row.slotIndex);
			if (row.rowIndex >= rowStart && row.rowIndex < rowStart + mountedRows) {
				retainedSlots.add(row.slotIndex);
			}
		}
	}

	// Free slots = slots used by rows that exited
	const freeSlots: number[] = [];
	for (const slot of allPreviousSlots) {
		if (!retainedSlots.has(slot)) {
			freeSlots.push(slot);
		}
	}
	freeSlots.sort((a, b) => a - b);
	let freeSlotOffset = 0;

	// Determine the next fresh slot index
	let nextSlotIndex = 0;
	if (previousRows) {
		for (const row of previousRows) {
			nextSlotIndex = Math.max(nextSlotIndex, row.slotIndex + 1);
		}
	}

	for (let r = 0; r < mountedRows; r += 1) {
		const rowIndex = rowStart + r;

		// Reuse the same slot if the row was present in the previous frame
		let slotIndex = previousSlotByRow.get(rowIndex);
		if (slotIndex === undefined) {
			// Entering row: take a free slot or allocate a new one
			const free = freeSlots[freeSlotOffset];
			if (free !== undefined) {
				freeSlotOffset += 1;
				slotIndex = free;
			} else {
				slotIndex = nextSlotIndex;
				nextSlotIndex += 1;
			}
		}

		const rowCells: TestMountedCell[] = [];
		for (let c = 0; c < COLUMNS; c += 1) {
			const itemIndex = rowIndex * COLUMNS + c;
			const sk = cellSlotKey(slotIndex, c);
			const cell: TestMountedCell = {
				key: `item-${itemIndex}` as LogicalCellKey,
				renderSlotKey: sk as RenderSlotKey,
				renderSlotIndex: sk,
				rowIndex,
				columnIndex: c,
				top: rowIndex * ROW_STRIDE,
				left: c * CELL_WIDTH,
				width: CELL_WIDTH,
				height: ROW_HEIGHT,
			};
			rowCells.push(cell);
			cells.push(cell);
		}

		rows.push({ slotIndex, rowIndex, top: rowIndex * ROW_STRIDE, cells: rowCells });
	}

	return { cells, rows };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getProbeElements(shadowRoot: ShadowRoot): HTMLElement[] {
	return Array.from(
		shadowRoot.querySelectorAll<HTMLElement>('[data-testid="probe-cell"]'),
	);
}

function getProbeKeys(shadowRoot: ShadowRoot): string[] {
	return getProbeElements(shadowRoot).map((el) => el.getAttribute("data-key") ?? "");
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe("VirtualSurface DOM remount contracts", () => {
	beforeEach(() => {
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		teardownAnimationFrameMock();
	});

	it("bounds DOM node count by mounted rows after scrolling one row", async () => {
		const initial = buildRowCellsWithSlotReuse(10, MOUNTED_ROWS);
		const contentHeight = Math.ceil(TOTAL_ITEMS / COLUMNS) * ROW_STRIDE;

		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: initial.cells,
				contentHeight,
				rowHeight: ROW_HEIGHT,
			},
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		await waitFor(() => {
			expect(getProbeElements(shadowRoot).length).toBe(MOUNTED_ROWS * COLUMNS);
		});

		// Scroll forward by one row
		const scrolled = buildRowCellsWithSlotReuse(11, MOUNTED_ROWS, initial.rows);
		await rerender({
			mountedCells: scrolled.cells,
			contentHeight,
			rowHeight: ROW_HEIGHT,
		});
		await flushFrames();

		expect(getProbeElements(shadowRoot).length).toBe(MOUNTED_ROWS * COLUMNS);
	});

	it("does not remount retained cells when the mounted range shifts by one row", async () => {
		const initial = buildRowCellsWithSlotReuse(10, MOUNTED_ROWS);
		const contentHeight = Math.ceil(TOTAL_ITEMS / COLUMNS) * ROW_STRIDE;

		const mountedKeys: string[] = [];
		const updatedKeys: string[] = [];

		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: initial.cells,
				contentHeight,
				rowHeight: ROW_HEIGHT,
				onCellMount: (key: string) => mountedKeys.push(key),
				onCellUpdate: (key: string) => updatedKeys.push(key),
			},
		});
		await flushFrames();

		await waitFor(() => {
			expect(mountedKeys.length).toBe(MOUNTED_ROWS * COLUMNS);
		});

		// Retained keys: rows [11..19)
		const retainedKeys = new Set<string>();
		for (let r = 11; r < 19; r += 1) {
			for (let c = 0; c < COLUMNS; c += 1) {
				retainedKeys.add(`item-${r * COLUMNS + c}`);
			}
		}

		mountedKeys.length = 0;
		updatedKeys.length = 0;

		// Shift the mounted range by one row forward
		const scrolled = buildRowCellsWithSlotReuse(11, MOUNTED_ROWS, initial.rows);
		await rerender({
			mountedCells: scrolled.cells,
			contentHeight,
			rowHeight: ROW_HEIGHT,
			onCellMount: (key: string) => mountedKeys.push(key),
			onCellUpdate: (key: string) => updatedKeys.push(key),
		});
		await flushFrames();

		// Retained keys must NOT trigger onCellMount again
		const remountedRetained = mountedKeys.filter((k) => retainedKeys.has(k));
		expect(remountedRetained).toStrictEqual([]);

		// Only the entering row (row 19, items 57-59) should mount
		const enteringKeys = ["item-57", "item-58", "item-59"];
		expect(mountedKeys).toEqual(expect.arrayContaining(enteringKeys));
		expect(mountedKeys.length).toBe(COLUMNS);
	});

	it("preserves DOM element identity for retained cells across a row shift", async () => {
		const initial = buildRowCellsWithSlotReuse(10, MOUNTED_ROWS);
		const contentHeight = Math.ceil(TOTAL_ITEMS / COLUMNS) * ROW_STRIDE;

		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: initial.cells,
				contentHeight,
				rowHeight: ROW_HEIGHT,
			},
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		await waitFor(() => {
			expect(getProbeElements(shadowRoot).length).toBe(MOUNTED_ROWS * COLUMNS);
		});

		// Snapshot the DOM element identity for a retained logical item (row 15, col 1 → item 46)
		const retainedKey = "item-46";
		const retainedProbeBefore = shadowRoot.querySelector(
			`[data-key="${retainedKey}"]`,
		);
		expect(retainedProbeBefore).toBeTruthy();

		// Shift mounted range by one row
		const scrolled = buildRowCellsWithSlotReuse(11, MOUNTED_ROWS, initial.rows);
		await rerender({
			mountedCells: scrolled.cells,
			contentHeight,
			rowHeight: ROW_HEIGHT,
		});
		await flushFrames();

		const retainedProbeAfter = shadowRoot.querySelector(
			`[data-key="${retainedKey}"]`,
		);
		expect(retainedProbeAfter).toBe(retainedProbeBefore);
	});

	it("replaces body content for the entering row without remounting retained rows", async () => {
		const initial = buildRowCellsWithSlotReuse(10, MOUNTED_ROWS);
		const contentHeight = Math.ceil(TOTAL_ITEMS / COLUMNS) * ROW_STRIDE;

		const mountedKeys: string[] = [];

		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: initial.cells,
				contentHeight,
				rowHeight: ROW_HEIGHT,
				onCellMount: (key: string) => mountedKeys.push(key),
			},
		});
		await flushFrames();

		await waitFor(() => {
			expect(mountedKeys.length).toBe(MOUNTED_ROWS * COLUMNS);
		});

		mountedKeys.length = 0;

		// Shift by one row forward
		const scrolled = buildRowCellsWithSlotReuse(11, MOUNTED_ROWS, initial.rows);
		await rerender({
			mountedCells: scrolled.cells,
			contentHeight,
			rowHeight: ROW_HEIGHT,
			onCellMount: (key: string) => mountedKeys.push(key),
		});
		await flushFrames();

		// The entering row (row 19) has 3 cells that just mounted
		expect(mountedKeys.length).toBe(COLUMNS);

		// All visible probes should reflect the new keys
		const host2 = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host2?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		const visibleKeys = getProbeKeys(shadowRoot);
		const expectedKeys = scrolled.cells.map((c) => c.key);
		expect(visibleKeys).toEqual(expectedKeys);
	});

	it("does not grow interaction descriptor registrations across row shifts", async () => {
		const interactionId = "virtual-list-items";
		const initial = buildRowCellsWithSlotReuse(10, MOUNTED_ROWS);
		const contentHeight = Math.ceil(TOTAL_ITEMS / COLUMNS) * ROW_STRIDE;

		const resolver = {
			interactionId,
			resolve: () => null,
		};

		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: initial.cells,
				contentHeight,
				rowHeight: ROW_HEIGHT,
				interactionId,
				interactionDescriptorResolvers: [resolver],
			},
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		await waitFor(() => {
			expect(getProbeElements(shadowRoot).length).toBe(MOUNTED_ROWS * COLUMNS);
		});

		// Snapshot the number of probe elements that carry the interaction id attribute
		const interactionProbesBefore = shadowRoot.querySelectorAll(
			"[data-ccl-interaction-id]",
		).length;

		// Shift mounted range by one row
		const scrolled = buildRowCellsWithSlotReuse(11, MOUNTED_ROWS, initial.rows);
		await rerender({
			mountedCells: scrolled.cells,
			contentHeight,
			rowHeight: ROW_HEIGHT,
			interactionId,
			interactionDescriptorResolvers: [resolver],
		});
		await flushFrames();

		// The count of interaction-attributed probes should remain bounded
		const interactionProbesAfter = shadowRoot.querySelectorAll(
			"[data-ccl-interaction-id]",
		).length;
		expect(interactionProbesAfter).toBe(interactionProbesBefore);
		expect(interactionProbesAfter).toBe(MOUNTED_ROWS * COLUMNS);
	});

	it("shifts the visible window backward without remounting retained cells", async () => {
		const initial = buildRowCellsWithSlotReuse(11, MOUNTED_ROWS);
		const contentHeight = Math.ceil(TOTAL_ITEMS / COLUMNS) * ROW_STRIDE;

		const mountedKeys: string[] = [];

		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: initial.cells,
				contentHeight,
				rowHeight: ROW_HEIGHT,
				onCellMount: (key: string) => mountedKeys.push(key),
			},
		});
		await flushFrames();

		await waitFor(() => {
			expect(mountedKeys.length).toBe(MOUNTED_ROWS * COLUMNS);
		});

		// Retained keys: rows [11..19)
		const retainedKeys = new Set<string>();
		for (let r = 11; r < 19; r += 1) {
			for (let c = 0; c < COLUMNS; c += 1) {
				retainedKeys.add(`item-${r * COLUMNS + c}`);
			}
		}

		mountedKeys.length = 0;

		// Shift mounted range by one row backward
		const scrolled = buildRowCellsWithSlotReuse(10, MOUNTED_ROWS, initial.rows);
		await rerender({
			mountedCells: scrolled.cells,
			contentHeight,
			rowHeight: ROW_HEIGHT,
			onCellMount: (key: string) => mountedKeys.push(key),
		});
		await flushFrames();

		// Retained keys must NOT trigger onCellMount
		const remountedRetained = mountedKeys.filter((k) => retainedKeys.has(k));
		expect(remountedRetained).toStrictEqual([]);

		// Only the entering row (row 10, items 30-32) should mount
		const enteringKeys = ["item-30", "item-31", "item-32"];
		expect(mountedKeys).toEqual(expect.arrayContaining(enteringKeys));
		expect(mountedKeys.length).toBe(COLUMNS);
	});
});
