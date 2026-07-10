import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	flushFrames,
	installAnimationFrameMock,
	teardownAnimationFrameMock,
} from "testing/helpers/DOMObserverMock";
import VirtualSurfaceRecyclingHarness from "./VirtualSurfaceRecyclingHarness.svelte";
import type { MountedVirtualCell, LogicalCellKey, RenderSlotKey } from "../types";
import type { ViewItem } from "application/presenters";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";

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

describe("VirtualSurface recycling", () => {
	beforeEach(() => {
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		teardownAnimationFrameMock();
	});

	it("shows correct visible items after scrolling", async () => {
		const cells1 = createCells(["A", "B", "C", "D"]);
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells1,
				contentHeight: 200,
				rowHeight: 50,
			},
		});
		await flushFrames();

		const cells2 = createCells(["E", "F"]);
		await rerender({
			mountedCells: cells2,
			contentHeight: 200,
			rowHeight: 50,
		});
		await flushFrames();

		const host2 = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot2 = host2?.shadowRoot;
		expect(shadowRoot2).toBeTruthy();
		if (!shadowRoot2) return;

		const cells = Array.from(
			shadowRoot2.querySelectorAll('[data-testid="probe-cell"]'),
		);
		const keys = cells.map((el) => el.getAttribute("data-key"));
		expect(keys).toEqual(["E", "F"]);
	});

	it("keeps mounted cell count bounded by unmounting cells that leave the viewport", async () => {
		const cells4 = createCells(["A", "B", "C", "D"]);
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells4,
				contentHeight: 200,
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

		expect(shadowRoot.querySelectorAll('[data-testid="probe-cell"]').length).toBe(
			4,
		);

		const cells2 = createCells(["E", "F"]);
		await rerender({
			mountedCells: cells2,
			contentHeight: 200,
			rowHeight: 50,
		});
		await flushFrames();

		expect(shadowRoot.querySelectorAll('[data-testid="probe-cell"]').length).toBe(
			2,
		);
	});

	it("does not remount existing visible items on a noop rerender", async () => {
		const mountedKeys: string[] = [];
		const cells = createCells(["A", "B"]);
		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells,
				contentHeight: 100,
				rowHeight: 50,
				onCellMount: (key: string) => mountedKeys.push(key),
			},
		});
		await flushFrames();
		expect(mountedKeys.length).toBe(2);

		mountedKeys.length = 0;
		await rerender({
			mountedCells: cells,
			contentHeight: 100,
			rowHeight: 50,
			onCellMount: (key: string) => mountedKeys.push(key),
		});
		await flushFrames();

		expect(mountedKeys).toStrictEqual([]);
	});

	it("keeps a resolved interaction descriptor cached across resolver array updates", async () => {
		const interactionId = "item:A";
		const descriptor = {
			interactionId,
			kind: "item",
			item: { type: "link" } as unknown as ViewItem,
			targetFile: null,
		} satisfies ItemInteractionDescriptor;
		const resolve = vi.fn(() => descriptor);
		const resolver = { interactionId, resolve };
		const cells = createCells(["A"]);
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells,
				contentHeight: 100,
				rowHeight: 50,
				interactionId,
				interactionDescriptorResolvers: [resolver],
			},
		});
		await flushFrames();

		const probe = container
			.querySelector<HTMLElement>(".recycling-test-root")
			?.shadowRoot?.querySelector<HTMLElement>('[data-testid="probe-cell"]');
		expect(probe).toBeTruthy();
		if (!probe) return;

		await fireEvent.click(probe);
		expect(resolve).toHaveBeenCalledTimes(1);

		await rerender({
			mountedCells: cells,
			contentHeight: 100,
			rowHeight: 50,
			interactionId,
			interactionDescriptorResolvers: [resolver],
		});
		await flushFrames();
		await fireEvent.click(probe);

		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("does not remount a body when only cell metadata changes", async () => {
		const mountedKeys: string[] = [];
		const renderBodyKey = "body:A";
		const cells = createCells(["A"]).map((cell) => ({
			...cell,
			cellMetadataKey: ["metadata", 1],
			renderBodyKey,
		}));
		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells,
				contentHeight: 100,
				rowHeight: 50,
				onCellMount: (key: string) => mountedKeys.push(key),
			},
		});
		await flushFrames();
		expect(mountedKeys).toStrictEqual(["A"]);

		mountedKeys.length = 0;
		await rerender({
			mountedCells: cells.map((cell) => ({
				...cell,
				top: 25,
				cellMetadataKey: ["metadata", 2],
				renderBodyKey,
			})),
			contentHeight: 100,
			rowHeight: 50,
			onCellMount: (key: string) => mountedKeys.push(key),
		});
		await flushFrames();

		expect(mountedKeys).toStrictEqual([]);
	});

	it("remounts a body when the render body key changes", async () => {
		const mountedKeys: string[] = [];
		const cells = createCells(["A"]).map((cell) => ({
			...cell,
			cellMetadataKey: ["metadata", 1],
			renderBodyKey: "body:A:1",
		}));
		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells,
				contentHeight: 100,
				rowHeight: 50,
				onCellMount: (key: string) => mountedKeys.push(key),
			},
		});
		await flushFrames();
		expect(mountedKeys).toStrictEqual(["A"]);

		mountedKeys.length = 0;
		await rerender({
			mountedCells: cells.map((cell) => ({
				...cell,
				cellMetadataKey: ["metadata", 2],
				renderBodyKey: "body:A:2",
			})),
			contentHeight: 100,
			rowHeight: 50,
			onCellMount: (key: string) => mountedKeys.push(key),
		});
		await flushFrames();

		expect(mountedKeys).toStrictEqual(["A"]);
	});

	it("updates grid-row content when a same-slot replacement changes body key", async () => {
		const mountedKeys: string[] = [];
		const cells = createCells(["A"]).map((cell) => ({
			...cell,
			renderBodyKey: "body:A:1",
		}));
		const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells,
				mountedRows: createRows(cells),
				contentHeight: 100,
				rowHeight: 50,
				layoutMode: "grid-rows",
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
			mountedCells: updatedCells,
			mountedRows: createRows(updatedCells),
			contentHeight: 100,
			rowHeight: 50,
			layoutMode: "grid-rows",
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
				mountedCells: cells,
				mountedRows: createRows(cells, {
					key: 0,
					rowIndex: 0,
					slotIndex: 0,
					slotKey: 0,
				}),
				contentHeight: 100,
				rowHeight: 50,
				layoutMode: "grid-rows",
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
			mountedCells: updatedCells,
			mountedRows: createRows(updatedCells, {
				key: 12,
				rowIndex: 12,
				top: 600,
				slotIndex: 0,
				slotKey: 0,
			}),
			contentHeight: 1000,
			rowHeight: 50,
			layoutMode: "grid-rows",
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

	it("keeps grid-row DOM order in physical slot order", async () => {
		const slotOneCells = createCells(["A"]).map((cell) => ({
			...cell,
			rowIndex: 1,
			columnIndex: 0,
		}));
		const slotZeroCells = createCells(["B"]).map((cell) => ({
			...cell,
			rowIndex: 2,
			columnIndex: 0,
		}));
		const { container } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: [...slotOneCells, ...slotZeroCells],
				mountedRows: [
					{
						key: 1,
						rowIndex: 1,
						top: 50,
						slotIndex: 1,
						slotKey: 1,
						cells: slotOneCells,
					},
					{
						key: 2,
						rowIndex: 2,
						top: 100,
						slotIndex: 0,
						slotKey: 0,
						cells: slotZeroCells,
					},
				],
				contentHeight: 200,
				rowHeight: 50,
				layoutMode: "grid-rows",
			},
		});
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		const rowShells = Array.from(
			shadowRoot.querySelectorAll<HTMLElement>("[data-ccl-row-slot]"),
		);
		expect(rowShells.map((row) => row.dataset.cclRowSlot)).toStrictEqual([
			"0",
			"1",
		]);
		expect(
			rowShells[0]
				?.querySelector('[data-testid="probe-cell"]')
				?.getAttribute("data-key"),
		).toBe("B");
		expect(rowShells[0]?.style.transform).toBe("translateY(100px)");
		expect(
			rowShells[1]
				?.querySelector('[data-testid="probe-cell"]')
				?.getAttribute("data-key"),
		).toBe("A");
		expect(rowShells[1]?.style.transform).toBe("translateY(50px)");
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
				mountedCells: cells,
				mountedRows: createRows(cells, {
					key: 0,
					rowIndex: 0,
					slotIndex: 0,
					slotKey: 0,
				}),
				contentHeight: 100,
				rowHeight: 50,
				layoutMode: "grid-rows",
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
			mountedCells: updatedCells,
			mountedRows: createRows(updatedCells, {
				key: 12,
				rowIndex: 12,
				top: 600,
				slotIndex: 0,
				slotKey: 0,
			}),
			contentHeight: 1000,
			rowHeight: 50,
			layoutMode: "grid-rows",
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
