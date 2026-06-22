import { describe, expect, test } from "vitest";
import {
	createBoundedGenerationalCache,
	type BoundedGenerationalCacheStats,
} from "utils/boundedGenerationalCache";

describe("createBoundedGenerationalCache", () => {
	test("returns undefined and counts a miss for an unseen key", () => {
		const cache = createBoundedGenerationalCache<string, string>("test", 4);

		expect(cache.get("missing")).toBeUndefined();
		expect(cache.getStats().misses).toBe(1);
		expect(cache.getStats().hits).toBe(0);
	});

	test("caches a value and counts a hit on the second read", () => {
		const cache = createBoundedGenerationalCache<string, string>("test", 4);

		cache.set("a", "A");
		expect(cache.get("a")).toBe("A");
		expect(cache.get("a")).toBe("A");

		const stats = cache.getStats();
		expect(stats.hits).toBe(2);
		expect(stats.misses).toBe(0);
		expect(stats.currentSize).toBe(1);
	});

	test("rotates the current generation when maxEntries is reached", () => {
		const cache = createBoundedGenerationalCache<string, string>("test", 3);

		cache.set("a", "A");
		cache.set("b", "B");
		cache.set("c", "C");

		// Third set reaches the limit, triggering a rotation.
		const statsAfterRotation = cache.getStats();
		expect(statsAfterRotation.generations).toBe(1);
		expect(statsAfterRotation.currentSize).toBe(0);
		expect(statsAfterRotation.previousSize).toBe(3);
	});

	test("still hits keys that moved into the previous generation", () => {
		const cache = createBoundedGenerationalCache<string, string>("test", 2);

		cache.set("a", "A");
		cache.set("b", "B");
		// Rotation: a and b are now in previous.

		expect(cache.get("a")).toBe("A");

		const stats = cache.getStats();
		expect(stats.hits).toBe(1);
		expect(stats.promotions).toBe(1);
		expect(stats.currentSize).toBe(1);
		expect(stats.previousSize).toBe(1);
	});

	test("promoting a previous-generation key back into current preserves it across rotations", () => {
		const cache = createBoundedGenerationalCache<string, string>("test", 2);

		cache.set("hot", "HOT");
		cache.set("b", "B");
		// Rotation 1: hot, b -> previous, current emptied.
		cache.set("c", "C");
		// current = {c}; no rotation yet.

		// Promote hot back into current before it ages out of previous.
		expect(cache.get("hot")).toBe("HOT");
		// current = {c, hot} -> Rotation 2: c, hot -> previous.
		cache.set("d", "D");
		// current = {d}; hot still retained in previous.

		expect(cache.get("hot")).toBe("HOT");
		// Promoted again: current = {d, hot} -> Rotation 3.
		const stats = cache.getStats();
		expect(stats.promotions).toBeGreaterThanOrEqual(2);
	});

	test("clear resets both generations and counts a clear", () => {
		const cache = createBoundedGenerationalCache<string, string>("test", 4);

		cache.set("a", "A");
		cache.set("b", "B");
		cache.clear();

		expect(cache.get("a")).toBeUndefined();
		const stats = cache.getStats();
		expect(stats.clears).toBe(1);
		expect(stats.currentSize).toBe(0);
		expect(stats.previousSize).toBe(0);
		// Misses accumulate across clears for debug visibility.
		expect(stats.misses).toBe(1);
	});

	test("throws when maxEntries is not positive", () => {
		expect(() => createBoundedGenerationalCache<string, string>("test", 0)).toThrow();
		expect(() =>
			createBoundedGenerationalCache<string, string>("test", -1),
		).toThrow();
	});

	test("stats report the configured name and maxEntries", () => {
		const cache = createBoundedGenerationalCache<string, string>("my-cache", 8);
		const stats: BoundedGenerationalCacheStats = cache.getStats();

		expect(stats.name).toBe("my-cache");
		expect(stats.maxEntries).toBe(8);
	});

	test("total retained entries stay bounded by roughly 2 * maxEntries", () => {
		const maxEntries = 4;
		const cache = createBoundedGenerationalCache<number, number>(
			"test",
			maxEntries,
		);

		// Insert far more entries than the limit.
		for (let i = 0; i < 100; i++) {
			cache.set(i, i);
		}

		const stats = cache.getStats();
		expect(stats.currentSize + stats.previousSize).toBeLessThanOrEqual(
			maxEntries * 2,
		);
	});
});
