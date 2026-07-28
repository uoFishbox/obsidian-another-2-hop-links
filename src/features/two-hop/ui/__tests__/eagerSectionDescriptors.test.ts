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

describe("eager section descriptors", () => {
	it("materializes complete primary rows when the descriptor is created", () => {
		const branches: TwoHopLinkBranch[] = [
			{ hop1: createLink("first.md"), hop2: [] },
			{ hop1: createLink("second.md"), hop2: [] },
		];
		const createItemInteractionToken = vi.fn(
			(_interactionKey: string) =>
				`i${createItemInteractionToken.mock.calls.length}`,
		);

		const descriptor = createPrimarySectionDescriptor({
			input: { kind: "outgoing", items: branches },
			createItemInteractionToken,
		});

		expect(createItemInteractionToken).toHaveBeenCalledTimes(2);
		const rows = descriptor.getItems();
		expect(descriptor.getItems()).toBe(rows);
		expect(descriptor.getItem(1)).toBe(rows[1]);
		expect(rows.map((row) => row.item.type)).toEqual(["branch", "branch"]);
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

		const descriptor = createNewLinksSectionDescriptor({
			items: links,
			createItemInteractionToken,
		});

		expect(createItemInteractionToken).toHaveBeenCalledTimes(2);
		const rows = descriptor.getItems();
		expect(descriptor.getItems()).toBe(rows);
		expect(descriptor.getItem(1)).toBe(rows[1]);
		expect(rows.map((row) => row.item.type)).toEqual(["newLink", "newLink"]);
	});
});
