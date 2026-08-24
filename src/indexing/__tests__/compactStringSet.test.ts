import { describe, expect, test } from "vitest";
import {
	addCompactStringSetValue,
	compactStringSetFirst,
	compactStringSetSize,
	compactStringSetValues,
	removeCompactStringSetValue,
	type CompactStringSet,
} from "shared/collections/compactStringSet";

describe("compactStringSet", () => {
	test("stores a singleton as a string and ignores duplicate additions", () => {
		const index = new Map<string, CompactStringSet>();

		addCompactStringSetValue(index, "key", "one");
		addCompactStringSetValue(index, "key", "one");

		expect(index.get("key")).toBe("one");
	});

	test("promotes a singleton when a distinct value is added", () => {
		const index = new Map<string, CompactStringSet>();

		addCompactStringSetValue(index, "key", "one");
		addCompactStringSetValue(index, "key", "two");
		const collection = index.get("key")!;

		expect(collection).toEqual(new Set(["one", "two"]));
		expect(compactStringSetSize(collection)).toBe(2);
		expect(compactStringSetFirst(collection)).toBe("one");
		expect(Array.from(compactStringSetValues(collection))).toEqual(["one", "two"]);
	});

	test("removes singleton entries and keeps promoted collections mutable", () => {
		const index = new Map<string, CompactStringSet>();
		addCompactStringSetValue(index, "singleton", "one");
		addCompactStringSetValue(index, "promoted", "one");
		addCompactStringSetValue(index, "promoted", "two");

		removeCompactStringSetValue(index, "singleton", "one");
		removeCompactStringSetValue(index, "promoted", "two");

		expect(index.has("singleton")).toBe(false);
		expect(index.get("promoted")).toEqual(new Set(["one"]));
	});
});
