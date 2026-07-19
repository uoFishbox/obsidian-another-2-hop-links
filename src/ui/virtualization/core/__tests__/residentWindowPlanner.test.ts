import { describe, expect, it } from "vitest";
import { planResidentWindow } from "../residentWindowPlanner";

describe("planResidentWindow", () => {
	it("keeps the current window while forward visible rows have headroom", () => {
		expect(
			planResidentWindow({
				current: { start: 10, end: 20 },
				visible: { start: 13, end: 17 },
				rowCount: 100,
				direction: "forward",
			}),
		).toMatchObject({ start: 10, end: 20, retainedCurrent: true });
	});

	it("moves the window forward with a larger ahead buffer near its edge", () => {
		expect(
			planResidentWindow({
				current: { start: 10, end: 20 },
				visible: { start: 17, end: 19 },
				rowCount: 100,
				direction: "forward",
			}),
		).toMatchObject({ start: 15, end: 24, retainedCurrent: false });
	});

	it("marks non-overlapping visible rows as a distant jump", () => {
		expect(
			planResidentWindow({
				current: { start: 10, end: 20 },
				visible: { start: 60, end: 63 },
				rowCount: 100,
				direction: "forward",
			}),
		).toMatchObject({ start: 58, end: 68, distantJump: true });
	});

	it("clamps buffers at the content edges", () => {
		expect(
			planResidentWindow({
				current: { start: 0, end: 0 },
				visible: { start: 0, end: 2 },
				rowCount: 5,
				direction: "none",
			}),
		).toMatchObject({ start: 0, end: 5 });
	});
});
