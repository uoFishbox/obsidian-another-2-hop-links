import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	flushFrames,
	installAnimationFrameMock,
	teardownAnimationFrameMock,
} from "testing/helpers/DOMObserverMock";
import VirtualSurfaceRecyclingHarness from "./VirtualSurfaceRecyclingHarness.svelte";
import type { MountedVirtualCell, LogicalCellKey, RenderSlotKey } from "../../types";

interface TestMountedCell extends MountedVirtualCell {
	columnIndex: number;
	top: number;
	left: number;
	width: number;
	height: number;
}

interface TestMountedRow {
	key: number;
	rowIndex: number;
	top: number;
	slotIndex?: number;
	slotKey?: number;
	cells: TestMountedCell[];
}

function createCells(keys: string[], slotOffset: number = 0): TestMountedCell[] {
	return keys.map((key, index) => ({
		key: key as LogicalCellKey,
		renderSlotKey: (slotOffset + index) as RenderSlotKey,
		renderSlotIndex: index,
		rowIndex: 0,
		columnIndex: index,
		top: 0,
		left: index * 100,
		width: 100,
		height: 50,
	}));
}

function createRows(
	cells: TestMountedCell[],
	options: {
		key?: number;
		rowIndex?: number;
		top?: number;
		slotIndex?: number;
		slotKey?: number;
	} = {},
): TestMountedRow[] {
	const row = {
		key: options.key ?? 0,
		rowIndex: options.rowIndex ?? 0,
		top: options.top ?? 0,
		slotIndex: options.slotIndex,
		slotKey: options.slotKey,
		cells,
	};
	return [row];
}

describe("VirtualSurface grid-row recycling", () => {
	beforeEach(() => {
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		teardownAnimationFrameMock();
	});

	it("updates grid-row content when a same-slot replacement changes body key", async () => {
		const mountedKeys: string[] = [];
		const cells = createCells(["A"]).map((cell) => ({
			...cell,
			renderBodyKey: "body:A:1",
		}));
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedRows: createRows(cells),
				contentHeight: 100,
				rowHeight: 50,
				onCellMount: (key: string) => mountedKeys.push(key),
			},
		});
		await flushFrames();
		expect(mountedKeys).toStrictEqual(["A"]);

		const updatedCells = createCells(["A"]).map((cell) => ({
			...cell,
			renderBodyKey: "body:A:2",
		}));
		mountedKeys.length = 0;
		await rerender({
			mountedRows: createRows(updatedCells),
			contentHeight: 100,
			rowHeight: 50,
			onCellMount: (key: string) => mountedKeys.push(key),
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		expect(
			shadowRoot
				?.querySelector('[data-testid="probe-cell"]')
				?.getAttribute("data-key"),
		).toBe("A");
		expect(mountedKeys).toStrictEqual(["A"]);
	});

	it("reuses grid row and cell shells by physical row slot", async () => {
		const cells = createCells(["A"]).map((cell) => ({
			...cell,
			rowIndex: 0,
			columnIndex: 0,
		}));
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedRows: createRows(cells, {
					key: 0,
					rowIndex: 0,
					slotIndex: 0,
					slotKey: 0,
				}),
				contentHeight: 100,
				rowHeight: 50,
			},
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		const rowShell = shadowRoot.querySelector("[data-ccl-row-slot='0']");
		const cellShell = shadowRoot.querySelector("[data-ccl-cell-slot]");
		expect(rowShell).toBeTruthy();
		expect(cellShell).toBeTruthy();

		const updatedCells = createCells(["B"]).map((cell) => ({
			...cell,
			rowIndex: 12,
			columnIndex: 0,
		}));
		await rerender({
			mountedRows: createRows(updatedCells, {
				key: 12,
				rowIndex: 12,
				top: 600,
				slotIndex: 0,
				slotKey: 0,
			}),
			contentHeight: 1000,
			rowHeight: 50,
		});
		await flushFrames();

		expect(shadowRoot.querySelector("[data-ccl-row-slot='0']")).toBe(rowShell);
		expect(shadowRoot.querySelector("[data-ccl-cell-slot]")).toBe(cellShell);
		expect((cellShell as HTMLElement | null)?.dataset.cclLogicalKey).toBe("B");
		expect(
			cellShell
				?.querySelector('[data-testid="probe-cell"]')
				?.getAttribute("data-key"),
		).toBe("B");
	});

	it("can reuse a grid-row body when the same physical slot receives another logical item", async () => {
		const mountedKeys: string[] = [];
		const updatedKeys: string[] = [];
		const cells = createCells(["A"]).map((cell) => ({
			...cell,
			renderBodyKey: "body:A",
			rowIndex: 0,
			columnIndex: 0,
		}));
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedRows: createRows(cells, {
					key: 0,
					rowIndex: 0,
					slotIndex: 0,
					slotKey: 0,
				}),
				contentHeight: 100,
				rowHeight: 50,
				remountCellBodyOnKeyChange: false,
				onCellMount: (key: string) => mountedKeys.push(key),
				onCellUpdate: (key: string) => updatedKeys.push(key),
			},
		});
		await flushFrames();
		expect(mountedKeys).toStrictEqual(["A"]);

		updatedKeys.length = 0;
		const updatedCells = createCells(["B"]).map((cell) => ({
			...cell,
			renderBodyKey: "body:B",
			rowIndex: 12,
			columnIndex: 0,
		}));
		await rerender({
			mountedRows: createRows(updatedCells, {
				key: 12,
				rowIndex: 12,
				top: 600,
				slotIndex: 0,
				slotKey: 0,
			}),
			contentHeight: 1000,
			rowHeight: 50,
			remountCellBodyOnKeyChange: false,
			onCellMount: (key: string) => mountedKeys.push(key),
			onCellUpdate: (key: string) => updatedKeys.push(key),
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const probe = host?.shadowRoot?.querySelector('[data-testid="probe-cell"]');
		expect(probe?.getAttribute("data-key")).toBe("B");
		expect(mountedKeys).toStrictEqual(["A"]);
		expect(updatedKeys).toStrictEqual(["B"]);
	});
});
