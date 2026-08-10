import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { createNewLinksSectionDescriptor } from "features/two-hop/ui/section-descriptors/createNewLinksDescriptor";
import { createPrimarySectionDescriptor } from "features/two-hop/ui/section-descriptors/createPrimaryDescriptor";
import type { TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";

const sourceFile = { path: "source.md" } as TFile;

const createLink = (path: string): TwoHopIndexedLink => ({
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
			(_interactionKey: string) =>
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

	it("materializes complete new-link rows when the descriptor is created", () => {
		const links = [
			{ ...createLink("first-missing.md"), isUnresolved: true },
			{ ...createLink("second-missing.md"), isUnresolved: true },
		];
		const createItemInteractionToken = vi.fn(
			(_interactionKey: string) =>
				`i${createItemInteractionToken.mock.calls.length}`,
		);

		const section = createNewLinksSectionDescriptor({
			items: links,
			itemLimit: links.length,
			previousItems: [],
			createItemInteractionToken,
		});

		expect(createItemInteractionToken).toHaveBeenCalledTimes(2);
		const rows = section.items;
		expect(Object.isFrozen(rows)).toBe(true);
		expect(section.items[1]).toBe(rows[1]);
		expect(rows.map((row) => row.item.type)).toEqual(["newLink", "newLink"]);
	});
});
