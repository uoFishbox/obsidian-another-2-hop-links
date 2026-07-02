import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { logicalCellKey, renderSlotKey, type MountedVirtualCell } from "../../types";
import type { RenderBodyKey } from "../../renderRevision";
import type { RowKey } from "../../rowKey";
import { VirtualSurfaceRowSlot } from "../VirtualSurfaceRowSlot.svelte";
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

describe("VirtualPooledGridRowsSurface row slot invalidation", () => {
	afterEach(() => {
		cleanup();
	});

	it("row top changes when the slot row is reassigned", async () => {
		const cell = makeCell("cell-1", 0, "body-1");
		const row = makeRow(0, 0, [cell]);
		const rowSlot = new VirtualSurfaceRowSlot<TestCell>(0);
		rowSlot.setRow(row);

		const { container } = render(VirtualPooledGridRowsSurfaceVersionHarness, {
			props: {
				mountedRowSlots: [rowSlot],
			},
		});

		const rowEl = container.querySelector(
			"[data-ccl-row-index='0']",
		) as HTMLElement;
		expect(rowEl).toBeTruthy();
		expect(rowEl.style.top).toBe("0px");
		expect(rowEl.style.transform).toBe("");

		rowSlot.setRow({
			...row,
			top: 120,
		});
		await tick();

		const updatedRowEl = container.querySelector(
			"[data-ccl-row-index='0']",
		) as HTMLElement;
		expect(updatedRowEl.style.top).toBe("120px");
		expect(updatedRowEl.style.transform).toBe("");
	});

	it("cell logical key changes when the slot row is reassigned", async () => {
		const cell = makeCell("logical-a", 0, "body-a");
		const row = makeRow(0, 0, [cell]);
		const rowSlot = new VirtualSurfaceRowSlot<TestCell>(0);
		rowSlot.setRow(row);

		const { container } = render(VirtualPooledGridRowsSurfaceVersionHarness, {
			props: {
				mountedRowSlots: [rowSlot],
			},
		});

		const cellEl = container.querySelector("[data-ccl-logical-key='logical-a']");
		expect(cellEl).toBeTruthy();

		rowSlot.setRow({
			...row,
			cells: [
				{
					...cell,
					key: logicalCellKey("logical-b"),
				},
			],
		});
		await tick();

		const updatedCellEl = container.querySelector(
			"[data-ccl-logical-key='logical-b']",
		);
		expect(updatedCellEl).toBeTruthy();
	});

	it("renderBodyKey change triggers body remount when the slot row is reassigned", async () => {
		const cell = makeCell("cell-body", 0, "original body", {
			renderBodyKey: "body-a" as RenderBodyKey,
		});
		const row = makeRow(0, 0, [cell]);
		const rowSlot = new VirtualSurfaceRowSlot<TestCell>(0);
		rowSlot.setRow(row);

		const { container } = render(VirtualPooledGridRowsSurfaceVersionHarness, {
			props: {
				mountedRowSlots: [rowSlot],
			},
		});

		const bodyEl = container.querySelector("[data-testid='cell-body']");
		expect(bodyEl?.textContent).toBe("original body");

		rowSlot.setRow({
			...row,
			cells: [
				{
					...cell,
					bodyContent: "updated body",
					renderBodyKey: "body-b" as RenderBodyKey,
				},
			],
		});
		await tick();

		const updatedBodyEl = container.querySelector("[data-testid='cell-body']");
		expect(updatedBodyEl?.textContent).toBe("updated body");
	});
});
