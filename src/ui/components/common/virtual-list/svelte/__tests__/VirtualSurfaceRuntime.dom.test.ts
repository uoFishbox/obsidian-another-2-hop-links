import { describe, expect, it } from "vitest";
import { findMountedCellElementByKey } from "../VirtualSurfaceNavigation";
import {
	createVirtualCellElementRegistration,
	findClosestRegisteredVirtualCell,
} from "../VirtualCellRegistry";

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

		const registration = createVirtualCellElementRegistration(cell);
		registration.update("registered-a", 1, 2);

		expect(findMountedCellElementByKey(container, "registered-a")).toBe(cell);

		const closest = findClosestRegisteredVirtualCell(cell);
		expect(closest?.element).toBe(cell);
		expect(closest?.metadata).toEqual({
			logicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		registration.unregister();

		expect(findMountedCellElementByKey(container, "registered-a")).toBeNull();
		expect(findClosestRegisteredVirtualCell(cell)).toBeNull();
	});
});
