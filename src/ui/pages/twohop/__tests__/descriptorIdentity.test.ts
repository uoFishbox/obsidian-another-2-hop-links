import { describe, expect, it, vi } from "vitest";
import { createSparseStableVirtualItemAccessors } from "../twoHopDataIdentityCache/descriptorIdentity";

describe("createSparseStableVirtualItemAccessors", () => {
	it("creates a ViewItem only for the requested sorted index", () => {
		const sources = Array.from({ length: 2_000 }, (_, index) => ({ index }));
		const getSortedItems = vi.fn(() => sources);
		const toViewItem = vi.fn((source: { index: number }) => ({ source }));
		const createItem = vi.fn(
			(item: { source: { index: number } }, key: string) =>
				({ kind: "new-link", item, key }) as never,
		);
		const accessors = createSparseStableVirtualItemAccessors({
			getLength: () => sources.length,
			getSortedItems,
			getKey: (source) => `source-${source.index}`,
			toViewItem,
			createItem,
		});

		expect(accessors.getItem(1_000)).toMatchObject({ key: "source-1000" });
		expect(getSortedItems).toHaveBeenCalledTimes(1);
		expect(toViewItem).toHaveBeenCalledTimes(1);
		expect(createItem).toHaveBeenCalledTimes(1);

		accessors.getItem(1_000);
		expect(toViewItem).toHaveBeenCalledTimes(1);
	});
});
