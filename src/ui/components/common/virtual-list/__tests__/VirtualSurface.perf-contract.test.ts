import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	flushFrames,
	installAnimationFrameMock,
	teardownAnimationFrameMock,
} from "testing/helpers/DOMObserverMock";
import VirtualSurfaceRecyclingHarness from "./VirtualSurfaceRecyclingHarness.svelte";
import type {
	MountedVirtualCell,
	LogicalCellKey,
	RenderSlotKey,
} from "../types";

interface TestMountedCell extends MountedVirtualCell {
	columnIndex: number;
	top: number;
	left: number;
	width: number;
	height: number;
}

function createCells(
	keys: string[],
	slotOffset: number = 0,
): TestMountedCell[] {
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

function createMountedGridCells(rowCount: number, columns: number) {
	// Model the bounded mounted range produced by the engine. This test starts
	// at the Svelte boundary so it can detect accidental full-list DOM renders.
	return Array.from({ length: rowCount * columns }, (_, index) => {
		const rowIndex = Math.floor(index / columns);
		const columnIndex = index % columns;
		return {
			key: `item-${index}` as LogicalCellKey,
			renderSlotKey: index as RenderSlotKey,
			renderSlotIndex: index,
			rowIndex,
			columnIndex,
			top: rowIndex * 50,
			left: columnIndex * 100,
			width: 100,
			height: 50,
		};
	});
}

describe("VirtualSurface performance contracts", () => {
	beforeEach(() => {
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		teardownAnimationFrameMock();
	});

	it("reuses DOM nodes when render slots are reassigned to different logical keys", async () => {
		const cells1 = createCells(["A", "B"]);
		const { container, rerender } = render(
			VirtualSurfaceRecyclingHarness,
			{
				props: {
					mountedCells: cells1,
					contentHeight: 100,
					rowHeight: 50,
				},
			},
		);
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		const content = shadowRoot.querySelector(".recycling-test-content");
		expect(content).not.toBeNull();
		if (!content) return;

		await waitFor(() => {
			expect(
				shadowRoot.querySelectorAll('[data-testid="probe-cell"]')
					.length,
			).toBe(2);
		});

		const firstChild = content.firstElementChild;

		const cells2: TestMountedCell[] = [
			{
				key: "C" as LogicalCellKey,
				renderSlotKey: 0 as RenderSlotKey,
				renderSlotIndex: 0,
				rowIndex: 0,
				columnIndex: 0,
				top: 0,
				left: 0,
				width: 100,
				height: 50,
			},
			{
				key: "D" as LogicalCellKey,
				renderSlotKey: 1 as RenderSlotKey,
				renderSlotIndex: 1,
				rowIndex: 0,
				columnIndex: 1,
				top: 0,
				left: 100,
				width: 100,
				height: 50,
			},
		];

		await rerender({
			mountedCells: cells2,
			contentHeight: 100,
			rowHeight: 50,
		});
		await flushFrames();

		expect(content.firstElementChild).toBe(firstChild);
		expect(
			firstChild
				?.querySelector('[data-testid="probe-cell"]')
				?.getAttribute("data-key"),
		).toBe("C");
	});

	it("updates item subtrees in place instead of remounting when render slots are reused", async () => {
		const mountedKeys: string[] = [];
		const updatedKeys: string[] = [];

		const cells1 = createCells(["A", "B"]);
		const { rerender } = render(VirtualSurfaceRecyclingHarness, {
			props: {
				mountedCells: cells1,
				contentHeight: 100,
				rowHeight: 50,
				onCellMount: (key: string) => mountedKeys.push(key),
				onCellUpdate: (key: string) => updatedKeys.push(key),
			},
		});
		await flushFrames();

		await waitFor(() => {
			expect(mountedKeys.length).toBe(2);
		});

		mountedKeys.length = 0;
		updatedKeys.length = 0;

		const cells2 = createCells(["C", "D"]);
		await rerender({
			mountedCells: cells2,
			contentHeight: 100,
			rowHeight: 50,
			onCellMount: (key: string) => mountedKeys.push(key),
			onCellUpdate: (key: string) => updatedKeys.push(key),
		});
		await flushFrames();

		expect(updatedKeys.length).toBeGreaterThan(0);
		expect(mountedKeys.length).toBeLessThanOrEqual(updatedKeys.length);
	});

	it("bounds rendered DOM cells by mounted rows instead of total card count", async () => {
		// Keep this card-count matrix aligned with PERFORMANCE.md and the engine
		// perf contract. Only the virtual content height grows between cases.
		const cardCounts = [100, 1_000, 10_000];
		const columns = 3;
		// The engine contract mounts five visible rows plus four overscan rows.
		const mountedRows = 9;
		const mountedCells = createMountedGridCells(mountedRows, columns);
		const { container, rerender } = render(
			VirtualSurfaceRecyclingHarness,
			{
				props: {
					mountedCells,
					contentHeight: Math.ceil(cardCounts[0] / columns) * 50,
					rowHeight: 50,
				},
			},
		);
		await flushFrames();

		const host = container.querySelector(
			".recycling-test-root",
		) as HTMLElement | null;
		const shadowRoot = host?.shadowRoot;
		expect(shadowRoot).toBeTruthy();
		if (!shadowRoot) return;

		const measurements: Array<{
			cardCount: number;
			mountedRows: number;
			renderedDomCells: number;
		}> = [];
		for (const cardCount of cardCounts) {
			// A larger content height represents more logical cards without
			// expanding the mounted-cell input passed to the Svelte surface.
			await rerender({
				mountedCells,
				contentHeight: Math.ceil(cardCount / columns) * 50,
				rowHeight: 50,
			});
			await flushFrames();

			const renderedDomCells = shadowRoot.querySelectorAll(
				'[data-testid="probe-cell"]',
			).length;
			measurements.push({
				cardCount,
				mountedRows,
				renderedDomCells,
			});
		}

		// Three columns across nine mounted rows yields 27 real Shadow DOM cells
		// even when the logical list grows to 10,000 cards.
		expect(measurements).toEqual(
			cardCounts.map((cardCount) => ({
				cardCount,
				mountedRows,
				renderedDomCells: mountedRows * columns,
			})),
		);
	});
});
