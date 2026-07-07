import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import { logicalCellKey, renderSlotKey, type MountedVirtualCell } from "../../types";
import type { RenderBodyKey } from "../../renderRevision";
import type { RowKey } from "../../rowKey";
import VirtualPooledGridRowsSurfaceVersionHarness from "./VirtualPooledGridRowsSurfaceVersionHarness.svelte";

interface TestCell extends MountedVirtualCell {
	bodyContent: string;
}

interface TestRow {
	key: RowKey;
	rowIndex: number;
	top: number;
	slotIndex?: number;
	slotKey?: number;
	attributes?: Record<string, string | number | undefined>;
	cells: TestCell[];
}

function makeCell(
	key: string,
	rowIndex: number,
	bodyContent: string,
	extras?: Partial<MountedVirtualCell>,
): TestCell {
	return {
		key: logicalCellKey(key),
		renderSlotKey: renderSlotKey(0),
		renderSlotIndex: 0,
		rowIndex,
		columnIndex: 0,
		bodyContent,
		...extras,
	};
}

function makeRow(
	rowIndex: number,
	top: number,
	cells: TestCell[],
	extras?: Partial<TestRow>,
): TestRow {
	return {
		key: rowIndex,
		rowIndex,
		top,
		cells,
		...extras,
	};
}

describe("VirtualPooledGridRowsSurface version invalidation", () => {
	afterEach(() => {
		cleanup();
	});

	it("same row object top mutation is reflected in flow spacers when version bumps", async () => {
		const cell = makeCell("cell-1", 0, "body-1");
		const row = makeRow(0, 0, [cell]);
		const mountedRows: TestRow[] = [row];

		const { container, rerender } = render(
			VirtualPooledGridRowsSurfaceVersionHarness,
			{
				props: {
					mountedRows,
					mountedRowsVersion: 0,
				},
			},
		);

		const rowEl = container.querySelector(
			"[data-ccl-row-index='0']",
		) as HTMLElement;
		const topSpacer = container.querySelector(
			"[data-ccl-virtual-flow-spacer='top']",
		) as HTMLElement;
		expect(rowEl).toBeTruthy();
		expect(rowEl.style.transform).toBe("");
		expect(topSpacer.style.height).toBe("0px");

		// Mutate same row object
		row.top = 120;

		await rerender({
			mountedRows,
			mountedRowsVersion: 1,
		});

		const updatedRowEl = container.querySelector(
			"[data-ccl-row-index='0']",
		) as HTMLElement;
		const updatedTopSpacer = container.querySelector(
			"[data-ccl-virtual-flow-spacer='top']",
		) as HTMLElement;
		expect(updatedRowEl.style.transform).toBe("");
		expect(updatedTopSpacer.style.height).toBe("120px");
	});

	it("same cell object logicalKey mutation is reflected when version bumps", async () => {
		const cell = makeCell("logical-a", 0, "body-a");
		const row = makeRow(0, 0, [cell]);
		const mountedRows: TestRow[] = [row];

		const { container, rerender } = render(
			VirtualPooledGridRowsSurfaceVersionHarness,
			{
				props: {
					mountedRows,
					mountedRowsVersion: 0,
				},
			},
		);

		const cellEl = container.querySelector("[data-ccl-logical-key='logical-a']");
		expect(cellEl).toBeTruthy();

		// Mutate same cell object's key
		(cell as { key: string }).key = "logical-b";

		await rerender({
			mountedRows,
			mountedRowsVersion: 1,
		});

		const updatedCellEl = container.querySelector(
			"[data-ccl-logical-key='logical-b']",
		);
		expect(updatedCellEl).toBeTruthy();
	});

	it("renderBodyKey change triggers body remount when version bumps", async () => {
		const cell = makeCell("cell-body", 0, "original body", {
			renderBodyKey: "body-a" as RenderBodyKey,
		});
		const row = makeRow(0, 0, [cell]);
		const mountedRows: TestRow[] = [row];

		const { container, rerender } = render(
			VirtualPooledGridRowsSurfaceVersionHarness,
			{
				props: {
					mountedRows,
					mountedRowsVersion: 0,
				},
			},
		);

		const bodyEl = container.querySelector("[data-testid='cell-body']");
		expect(bodyEl?.textContent).toBe("original body");

		// Mutate cell to change body and renderBodyKey
		cell.bodyContent = "updated body";
		(cell as { renderBodyKey: unknown }).renderBodyKey = "body-b";

		await rerender({
			mountedRows,
			mountedRowsVersion: 1,
		});

		const updatedBodyEl = container.querySelector("[data-testid='cell-body']");
		expect(updatedBodyEl?.textContent).toBe("updated body");
	});
});
