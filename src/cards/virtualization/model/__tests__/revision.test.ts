import { describe, expect, it } from "vitest";
import { hasSameVirtualListRevision } from "../../engine/snapshotComputation";

describe("VirtualListRevision", () => {
	it("compares content and layout array tokens shallowly with Object.is semantics", () => {
		const rows = [{ key: 0 }];
		const sharedObject = { width: 100 };
		const current = {
			content: rows,
			layout: [3, 100, NaN, sharedObject],
		};
		const same = {
			content: [...rows],
			layout: [3, 100, NaN, sharedObject],
		};
		const changedLayout = {
			content: rows,
			layout: [4, 100, NaN, sharedObject],
		};

		expect(hasSameVirtualListRevision(current, same)).toBe(true);
		expect(hasSameVirtualListRevision(current, changedLayout)).toBe(false);
	});

	it("keeps revision values distinct without string coercion or object deep comparison", () => {
		const current = { content: [], layout: ["1:2", 3, { width: 100 }] };
		const differentValues = {
			content: [],
			layout: [1, "2:3", { width: 100 }],
		};

		expect(hasSameVirtualListRevision(current, differentValues)).toBe(false);
	});
});
