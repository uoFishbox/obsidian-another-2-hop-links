import { describe, expect, it } from "vitest";
import { findMountedCellElementByKey } from "../VirtualSurfaceNavigation";

describe("findMountedCellElementByKey", () => {
	it("finds mounted cell elements by logical key attributes", () => {
		const container = document.createElement("div");
		const first = document.createElement("div");
		const second = document.createElement("div");
		first.dataset.cclLogicalKey = "a";
		second.dataset.cclLogicalKey = "b:quoted/path";
		container.append(first, second);

		expect(findMountedCellElementByKey(container, "a")).toBe(first);
		expect(findMountedCellElementByKey(container, "b:quoted/path")).toBe(
			second,
		);
		expect(findMountedCellElementByKey(container, "missing")).toBeNull();
	});

	it("returns null for empty lookup keys", () => {
		const container = document.createElement("div");

		expect(findMountedCellElementByKey(container, null)).toBeNull();
		expect(findMountedCellElementByKey(container, undefined)).toBeNull();
		expect(findMountedCellElementByKey(container, "")).toBeNull();
	});
});
