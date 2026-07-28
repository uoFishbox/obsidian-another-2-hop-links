import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVirtualSurfaceResidentRowsAdapter } from "ui/virtualization/svelte/residentRowViewState.svelte";
import {
	logicalCellKey,
	renderSlotKey,
	type MountedVirtualCell,
} from "ui/virtualization/types";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";
import type { SectionedGridMountedCellSlot } from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";
import ResidentRowsSurfaceHarness from "./ResidentRowsSurfaceHarness.svelte";
import { createSurfaceVirtualCellRegistry } from "ui/virtualization/svelte/VirtualCellRegistry";

interface TestMountedCell extends MountedVirtualCell {
	readonly label: string;
}

interface TestMountedRow extends VirtualSurfaceMountedRow<TestMountedCell> {
	readonly slotIndex: number;
	readonly cellSlots: readonly SectionedGridMountedCellSlot<TestMountedCell>[];
}

function createRow(
	slotIndex: number,
	rowIndex: number,
	label?: string,
): TestMountedRow {
	const binding: TestMountedCell | null =
		label === undefined
			? null
			: {
					key: logicalCellKey(label),
					renderSlotKey: renderSlotKey(slotIndex),
					renderSlotIndex: slotIndex,
					cellSlotKey: slotIndex,
					rowIndex,
					columnIndex: 0,
					label,
				};
	return {
		key: rowIndex,
		rowIndex,
		top: rowIndex * 100,
		slotIndex,
		slotKey: slotIndex,
		cells: binding ? [binding] : [],
		cellSlots: [
			{
				renderSlotIndex: slotIndex,
				renderSlotKey: renderSlotKey(slotIndex),
				columnIndex: 0,
				binding,
			},
		],
	};
}

afterEach(cleanup);

describe("residentRowViewState", () => {
	it("keeps array and retained slot identities while replacing only changed rows", () => {
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		const initialSlot0 = createRow(0, 10);
		const retainedSlot1 = createRow(1, 11);
		adapter.sync([initialSlot0, retainedSlot1]);

		const residentRows = adapter.rows;
		const residentSlot0 = residentRows[0];
		const residentSlot1 = residentRows[1];
		const replacementSlot0 = createRow(0, 12);
		adapter.sync([replacementSlot0, retainedSlot1]);

		expect(adapter.rows).toBe(residentRows);
		expect(adapter.rows[0]).toBe(residentSlot0);
		expect(adapter.rows[1]).toBe(residentSlot1);
		expect(adapter.rows[0]?.row).toBe(replacementSlot0);
		expect(adapter.rows[1]?.row).toBe(retainedSlot1);
	});

	it("publishes only active slots and drops peak-capacity holes", () => {
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		const rowInSlot2 = createRow(2, 20);
		adapter.sync([rowInSlot2]);
		const initialRows = adapter.rows;

		expect(initialRows).toHaveLength(1);
		expect(initialRows[0]?.slotIndex).toBe(2);
		expect(initialRows[0]?.row).toBe(rowInSlot2);

		adapter.sync([]);
		const emptyRows = adapter.rows;
		expect(emptyRows).toHaveLength(0);

		adapter.sync([]);
		expect(adapter.rows).toBe(emptyRows);
	});

	it("does not reevaluate retained row expressions when another slot changes", async () => {
		const resolveCellClassName = vi.fn((cell: TestMountedCell) => cell.label);
		const initialSlot0 = createRow(0, 0, "slot-0-initial");
		const retainedSlot1 = createRow(1, 1, "slot-1-retained");
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		adapter.sync([initialSlot0, retainedSlot1]);
		render(ResidentRowsSurfaceHarness, {
			props: {
				residentRows: adapter.rows,
				getCellClassName: resolveCellClassName,
			},
		});
		await tick();
		resolveCellClassName.mockClear();

		const replacementSlot0 = createRow(0, 2, "slot-0-replacement");
		adapter.sync([replacementSlot0, retainedSlot1]);
		await tick();

		expect(resolveCellClassName).toHaveBeenCalled();
		expect(resolveCellClassName.mock.calls.map(([cell]) => cell.label)).toContain(
			"slot-0-replacement",
		);
		expect(
			resolveCellClassName.mock.calls.map(([cell]) => cell.label),
		).not.toContain("slot-1-retained");
	});

	it("keeps row and cell DOM shells when a resident slot changes logical row", async () => {
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		adapter.sync([createRow(0, 100, "row-100")]);
		const { container } = render(ResidentRowsSurfaceHarness, {
			props: {
				residentRows: adapter.rows,
				getCellClassName: () => undefined,
			},
		});
		await tick();

		const host = container.querySelector(
			".resident-rows-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		const previousRowElement = shadowRoot.querySelector("[data-ccl-row-slot='0']");
		const previousCellElement = shadowRoot.querySelector("[data-ccl-cell-slot]");
		expect(previousRowElement).toBeTruthy();
		expect(previousCellElement).toBeTruthy();

		adapter.sync([createRow(0, 101, "row-101")]);
		await tick();

		expect(shadowRoot.querySelector("[data-ccl-row-slot='0']")).toBe(
			previousRowElement,
		);
		expect(shadowRoot.querySelector("[data-ccl-cell-slot]")).toBe(
			previousCellElement,
		);
		expect(previousCellElement?.textContent).toContain("row-101");
	});

	it("keeps the cell DOM shell across occupied, empty, and occupied bindings", async () => {
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		const registry = createSurfaceVirtualCellRegistry();
		const onCellMount = vi.fn();
		const onCellDestroy = vi.fn();
		adapter.sync([createRow(0, 100, "row-100")]);
		const { container } = render(ResidentRowsSurfaceHarness, {
			props: {
				residentRows: adapter.rows,
				getCellClassName: () => undefined,
				onCellMount,
				onCellDestroy,
				cellRegistry: registry,
			},
		});
		await tick();

		const host = container.querySelector(
			".resident-rows-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		const cellShell = shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-cell-slot='0']",
		);
		expect(cellShell?.textContent).toContain("row-100");
		expect(onCellMount).toHaveBeenCalledTimes(1);
		expect(registry.findByKey("row-100")).toBe(cellShell);

		adapter.sync([createRow(0, 101)]);
		await tick();

		expect(shadowRoot?.querySelector("[data-ccl-cell-slot='0']")).toBe(cellShell);
		expect(cellShell?.getAttribute("aria-hidden")).toBe("true");
		expect(cellShell?.dataset.cclLogicalKey).toBeUndefined();
		expect(cellShell?.textContent).toBe("");
		expect(onCellDestroy).toHaveBeenCalledTimes(1);
		expect(registry.findByKey("row-100")).toBeNull();
		expect(registry.findClosest(cellShell ?? null)).toBeNull();

		adapter.sync([createRow(0, 102, "row-102")]);
		await tick();

		expect(shadowRoot?.querySelector("[data-ccl-cell-slot='0']")).toBe(cellShell);
		expect(cellShell?.hasAttribute("aria-hidden")).toBe(false);
		expect(cellShell?.dataset.cclLogicalKey).toBe("row-102");
		expect(cellShell?.textContent).toContain("row-102");
		expect(onCellMount).toHaveBeenCalledTimes(2);
		expect(registry.findByKey("row-102")).toBe(cellShell);
	});
});
