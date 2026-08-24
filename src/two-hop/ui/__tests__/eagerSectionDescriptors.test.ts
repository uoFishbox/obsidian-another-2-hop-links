import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { createPrimarySectionDescriptor } from "two-hop/ui/section-descriptors/descriptors";
import type { IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch } from "two-hop/model";

const sourceFile = { path: "source.md" } as TFile;

const createLink = (path: string): IndexedLink => ({
	rawText: path,
	path,
	isUnresolved: false,
	sourceFile,
});

describe("section descriptor prefix materialization", () => {
	it("materializes and expands only the requested primary prefix", () => {
		const branches: TwoHopLinkBranch[] = Array.from(
			{ length: 2_000 },
			(_, index) => ({ hop1: createLink(`${index}.md`), hop2: [] }),
		);
		const createItemInteractionToken = vi.fn(
			(_semanticKey: string) =>
				`i${createItemInteractionToken.mock.calls.length}`,
		);

		const section = createPrimarySectionDescriptor({
			input: { kind: "outgoing", items: branches },
			itemLimit: 20,
			previousItems: [],
			createItemInteractionToken,
		});

		expect(createItemInteractionToken).toHaveBeenCalledTimes(20);
		expect(section.totalCount).toBe(2_000);
		expect(section.items).toHaveLength(20);
		const rows = section.items;
		const expanded = createPrimarySectionDescriptor({
			input: { kind: "outgoing", items: branches },
			itemLimit: 40,
			previousItems: rows,
			createItemInteractionToken,
		});

		expect(createItemInteractionToken).toHaveBeenCalledTimes(40);
		expect(expanded.items).toHaveLength(40);
		expect(expanded.items[0]).toBe(rows[0]);
		expect(expanded.items[19]).toBe(rows[19]);
	});
});
