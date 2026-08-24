import { describe, expect, test } from "vitest";
import { createBoundedGenerationalCache } from "shared/cache/boundedGenerationalCache";

describe("createBoundedGenerationalCache", () => {
	test("returns cached values and undefined for unseen keys", () => {
		const cache = createBoundedGenerationalCache<string, string>(4);

		cache.set("a", "A");

		expect(cache.get("a")).toBe("A");
		expect(cache.get("missing")).toBeUndefined();
	});

	test("promotes hot keys from the previous generation", () => {
		const cache = createBoundedGenerationalCache<string, string>(2);

		cache.set("hot", "HOT");
		cache.set("b", "B");
		cache.set("c", "C");
		expect(cache.get("hot")).toBe("HOT");

		cache.set("d", "D");

		expect(cache.get("hot")).toBe("HOT");
		expect(cache.get("b")).toBeUndefined();
	});

	test("evicts entries after they age out of two generations", () => {
		const cache = createBoundedGenerationalCache<number, number>(2);

		for (let index = 0; index < 6; index += 1) {
			cache.set(index, index);
		}

		expect(cache.get(0)).toBeUndefined();
		expect(cache.get(5)).toBe(5);
	});

	test("throws when maxEntries is not positive", () => {
		expect(() => createBoundedGenerationalCache(0)).toThrow();
		expect(() => createBoundedGenerationalCache(-1)).toThrow();
	});
});
