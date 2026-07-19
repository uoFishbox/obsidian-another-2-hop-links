import { describe, expect, it } from "vitest";
import { mergeItemsPreservingUnchanged } from "ui/shared/views/itemDiff";

type Item = {
	key: string;
	version: number;
	value: string;
};

describe("mergeItemsPreservingUnchanged", () => {
	it("reuses previous reference for unchanged items", () => {
		const previous: Item[] = [
			{ key: "a", version: 1, value: "old-a" },
			{ key: "b", version: 1, value: "old-b" },
		];
		const next: Item[] = [
			{ key: "a", version: 1, value: "new-a" },
			{ key: "b", version: 2, value: "new-b" },
		];

		const merged = mergeItemsPreservingUnchanged(previous, next, {
			getKey: (item) => item.key,
			getVersion: (item) => item.version,
		});

		expect(merged[0]).toBe(previous[0]);
		expect(merged[1]).toBe(next[1]);
	});

	it("prioritizes next for keys in changedKeys", () => {
		const previous: Item[] = [{ key: "a", version: 1, value: "old-a" }];
		const next: Item[] = [{ key: "a", version: 1, value: "new-a" }];

		const merged = mergeItemsPreservingUnchanged(previous, next, {
			getKey: (item) => item.key,
			getVersion: (item) => item.version,
			changedKeys: new Set(["a"]),
		});

		expect(merged[0]).toBe(next[0]);
	});
});
