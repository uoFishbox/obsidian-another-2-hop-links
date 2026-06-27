import { describe, expect, it } from "vitest";
import { affectsMountedRows } from "../twoHopMaterializationRecomputePolicy";

describe("affectsMountedRows", () => {
	it("does not recompute when no rows changed", () => {
		expect(affectsMountedRows({ start: 1, end: 3 }, null)).toBe(false);
	});

	it("recomputes when mounted rows have not been measured yet", () => {
		expect(affectsMountedRows(undefined, { start: 4, end: 5 })).toBe(true);
	});

	it("recomputes only when changed rows overlap mounted rows", () => {
		expect(affectsMountedRows({ start: 10, end: 20 }, { start: 12, end: 13 })).toBe(
			true,
		);
		expect(affectsMountedRows({ start: 10, end: 20 }, { start: 20, end: 25 })).toBe(
			false,
		);
		expect(affectsMountedRows({ start: 10, end: 20 }, { start: 0, end: 10 })).toBe(
			false,
		);
	});
});
