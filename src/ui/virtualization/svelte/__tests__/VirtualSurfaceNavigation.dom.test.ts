import { describe, expect, it } from "vitest";
import { findMountedCellElementByKey } from "../VirtualSurfaceNavigation";
import { createVirtualGridSurfaceTransaction } from "../VirtualGridSurfaceTransaction";

describe("findMountedCellElementByKey", () => {
	it("returns null for empty lookup keys", () => {
		const container = document.createElement("div");
		const transaction = createVirtualGridSurfaceTransaction();

		expect(findMountedCellElementByKey(container, null, transaction)).toBeNull();
		expect(
			findMountedCellElementByKey(container, undefined, transaction),
		).toBeNull();
		expect(findMountedCellElementByKey(container, "", transaction)).toBeNull();
	});

	it("finds mounted cell elements through the in-memory registry", () => {
		const container = document.createElement("div");
		const cell = document.createElement("div");
		container.append(cell);

		const transaction = createVirtualGridSurfaceTransaction();
		transaction.rebindCell(cell, {
			nextLogicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		expect(
			findMountedCellElementByKey(container, "registered-a", transaction),
		).toBe(cell);

		const closest = transaction.findClosestCell(cell);
		expect(closest?.element).toBe(cell);
		expect(closest?.metadata).toEqual({
			logicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		transaction.releaseCell(cell);

		expect(
			findMountedCellElementByKey(container, "registered-a", transaction),
		).toBeNull();
		expect(transaction.findClosestCell(cell)).toBeNull();
	});
});
