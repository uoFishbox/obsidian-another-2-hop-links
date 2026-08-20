import { describe, expect, it } from "vitest";
import { findMountedCellElementByKey } from "../surfaceNavigation";
import { createVirtualCellBindingRegistry } from "../cellBindingRegistry";

describe("findMountedCellElementByKey", () => {
	it("returns null for empty lookup keys", () => {
		const container = document.createElement("div");
		const registry = createVirtualCellBindingRegistry();

		expect(findMountedCellElementByKey(container, null, registry)).toBeNull();
		expect(findMountedCellElementByKey(container, undefined, registry)).toBeNull();
		expect(findMountedCellElementByKey(container, "", registry)).toBeNull();
	});

	it("finds mounted cell elements through the in-memory registry", () => {
		const container = document.createElement("div");
		const cell = document.createElement("div");
		container.append(cell);

		const registry = createVirtualCellBindingRegistry();
		registry.rebindCell(cell, {
			nextLogicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		expect(findMountedCellElementByKey(container, "registered-a", registry)).toBe(
			cell,
		);

		const closest = registry.findClosestCell(cell);
		expect(closest?.element).toBe(cell);
		expect(closest?.metadata).toEqual({
			logicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		registry.releaseCell(cell);

		expect(
			findMountedCellElementByKey(container, "registered-a", registry),
		).toBeNull();
		expect(registry.findClosestCell(cell)).toBeNull();
	});
});
