import { describe, expect, it } from "vitest";
import { findMountedCellElementByKey } from "../VirtualSurfaceNavigation";
import { createVirtualGridSurfaceTransaction } from "../VirtualGridSurfaceTransaction";

describe("findMountedCellElementByKey", () => {
	it("finds mounted cell elements by logical key attributes", () => {
		const container = document.createElement("div");
		const first = document.createElement("div");
		const second = document.createElement("div");
		first.dataset.cclLogicalKey = "a";
		second.dataset.cclLogicalKey = "b:quoted/path";
		container.append(first, second);

		expect(findMountedCellElementByKey(container, "a")).toBe(first);
		expect(findMountedCellElementByKey(container, "b:quoted/path")).toBe(second);
		expect(findMountedCellElementByKey(container, "missing")).toBeNull();
	});

	it("returns null for empty lookup keys", () => {
		const container = document.createElement("div");

		expect(findMountedCellElementByKey(container, null)).toBeNull();
		expect(findMountedCellElementByKey(container, undefined)).toBeNull();
		expect(findMountedCellElementByKey(container, "")).toBeNull();
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
