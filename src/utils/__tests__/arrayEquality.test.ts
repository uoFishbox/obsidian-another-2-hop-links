import { describe, expect, test, vi } from "vitest";
import { sameArrayBy, samePrimitiveArray } from "utils/arrayEquality";

describe("arrayEquality", () => {
	test("returns before comparing items when array references match", () => {
		const items = [{ id: "a" }];
		const equals = vi.fn(() => false);

		expect(sameArrayBy(items, items, equals)).toBe(true);
		expect(equals).not.toHaveBeenCalled();
	});

	test("compares arrays with a custom equality predicate", () => {
		const current = [{ id: "a" }, { id: "b" }];
		const next = [{ id: "a" }, { id: "b" }];
		const different = [{ id: "a" }, { id: "c" }];

		expect(
			sameArrayBy(
				current,
				next,
				(currentItem, nextItem) => currentItem.id === nextItem.id,
			),
		).toBe(true);
		expect(
			sameArrayBy(
				current,
				different,
				(currentItem, nextItem) => currentItem.id === nextItem.id,
			),
		).toBe(false);
	});

	test("compares primitive arrays by strict equality", () => {
		const shared = ["a", "b"];
		expect(samePrimitiveArray(shared, shared)).toBe(true);
		expect(samePrimitiveArray(["a", "b"], ["a", "b"])).toBe(true);
		expect(samePrimitiveArray(["a", "b"], ["b", "a"])).toBe(false);
		expect(samePrimitiveArray(["a"], ["a", "b"])).toBe(false);
	});
});
