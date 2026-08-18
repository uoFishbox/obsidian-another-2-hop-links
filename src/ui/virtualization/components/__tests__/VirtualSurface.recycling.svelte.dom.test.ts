import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	flushFrames,
	installAnimationFrameMock,
	teardownAnimationFrameMock,
} from "testing/helpers/DOMObserverMock";
import VirtualSurfaceRecyclingHarness from "./VirtualSurfaceRecyclingHarness.svelte";
import { type MountedVirtualCell, type LogicalCellKey } from "../../types";

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
	slotIndex: number;
	bindings: Array<TestMountedCell | null>;
}

function createCells(keys: string[], slotOffset: number = 0): TestMountedCell[] {
	return keys.map((key, index) => ({
		key: key as LogicalCellKey,
		renderSlotIndex: slotOffset + index,
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
	} = {},
): TestMountedRow[] {
	const row = {
		key: options.key ?? 0,
		rowIndex: options.rowIndex ?? 0,
		top: options.top ?? 0,
		slotIndex: options.slotIndex ?? 0,
		bindings: cells,
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

	it.each([
		["keyed", true],
		["physical-slot", false],
	])(
		"keeps the occupied → empty → occupied transition on one physical slot safe (%s policy)",
		async (_policyName, remountCellBodyOnKeyChange) => {
			const mountedKeys: string[] = [];
			const unmountedKeys: string[] = [];
			const createRow = (binding: TestMountedCell | null): TestMountedRow[] => [
				{
					key: 0,
					rowIndex: 0,
					top: 0,
					slotIndex: 0,
					bindings: [binding],
				},
			];
			const rerenderProps = (binding: TestMountedCell | null) => ({
				mountedRows: createRow(binding),
				contentHeight: 100,
				rowHeight: 50,
				remountCellBodyOnKeyChange,
				onCellMount: (key: string) => mountedKeys.push(key),
				onCellUnmount: (key: string) => unmountedKeys.push(key),
			});

			const { container, rerender } = render(VirtualSurfaceRecyclingHarness, {
				props: rerenderProps(createCells(["A"])[0]),
			});
			await flushFrames();
			expect(mountedKeys).toStrictEqual(["A"]);

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
			expect(
				cellShell
					?.querySelector('[data-testid="probe-cell"]')
					?.getAttribute("data-key"),
			).toBe("A");

			await rerender(rerenderProps(null));
			await flushFrames();

			expect(shadowRoot.querySelector("[data-ccl-row-slot='0']")).toBe(rowShell);
			expect(shadowRoot.querySelector("[data-ccl-cell-slot]")).toBe(cellShell);
			expect(cellShell?.querySelector('[data-testid="probe-cell"]')).toBeNull();
			expect(cellShell?.getAttribute("aria-hidden")).toBe("true");
			expect((cellShell as HTMLElement | null)?.dataset.cclLogicalKey).toBe(
				undefined,
			);
			expect(unmountedKeys).toStrictEqual(["A"]);

			await rerender(rerenderProps(createCells(["B"])[0]));
			await flushFrames();

			expect(shadowRoot.querySelector("[data-ccl-row-slot='0']")).toBe(rowShell);
			expect(shadowRoot.querySelector("[data-ccl-cell-slot]")).toBe(cellShell);
			expect(
				cellShell
					?.querySelector('[data-testid="probe-cell"]')
					?.getAttribute("data-key"),
			).toBe("B");
			expect(cellShell?.getAttribute("aria-hidden")).toBeNull();
			expect((cellShell as HTMLElement | null)?.dataset.cclLogicalKey).toBe("B");
			expect(mountedKeys).toStrictEqual(["A", "B"]);
			expect(unmountedKeys).toStrictEqual(["A"]);
		},
	);

	it("does not render an empty physical slot while its structural revision changes", async () => {
		const createRow = (binding: TestMountedCell | null): TestMountedRow[] => [
			{
				key: 0,
				rowIndex: 0,
				top: 0,
				slotIndex: 0,
				bindings: [binding],
			},
		];
		const mountedKeys: string[] = [];
		const unmountedKeys: string[] = [];
		const initialCell = createCells(["A"])[0];
		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedRows: createRow(initialCell),
				contentHeight: 100,
				rowHeight: 50,
				remountCellBodyOnKeyChange: false,
				physicalSlotRevision: 1,
				onCellMount: (key: string) => mountedKeys.push(key),
				onCellUnmount: (key: string) => unmountedKeys.push(key),
			},
		});
		await flushFrames();
		expect(mountedKeys).toStrictEqual(["A"]);

		await rerender({
			mountedRows: createRow(null),
			contentHeight: 100,
			rowHeight: 50,
			remountCellBodyOnKeyChange: false,
			physicalSlotRevision: 2,
			onCellMount: (key: string) => mountedKeys.push(key),
			onCellUnmount: (key: string) => unmountedKeys.push(key),
		});
		await flushFrames();

		expect(mountedKeys).toStrictEqual(["A"]);
		expect(unmountedKeys).toStrictEqual(["A"]);
	});
});
