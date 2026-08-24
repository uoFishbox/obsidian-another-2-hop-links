import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TaggedNote } from "indexing/model";

const { openTagNotesView } = vi.hoisted(() => ({
	openTagNotesView: vi.fn(),
}));

vi.mock("search/tag-notes/TagNotesView", () => ({
	openTagNotesView,
}));

import { handleTagClick } from "cards/context/linkContextFactory";

describe("handleTagClick", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("opens TagNotesView after tag retrieval completes", async () => {
		let resolveNotes: ((notes: TaggedNote[]) => void) | undefined;
		const indexingService = {
			getNotesWithTag: vi.fn(
				() =>
					new Promise<TaggedNote[]>((resolve) => {
						resolveNotes = resolve;
					}),
			),
		};
		const linkContext = {
			sourceFile: { path: "source.md" },
		} as any;
		const plugin = {} as any;

		const pending = handleTagClick(
			"tag1",
			linkContext,
			indexingService as any,
			plugin,
		);

		expect(openTagNotesView).not.toHaveBeenCalled();

		resolveNotes?.([{ path: "note.md" } as TaggedNote]);
		await pending;

		expect(indexingService.getNotesWithTag).toHaveBeenCalledWith(
			"tag1",
			"source.md",
		);
		expect(openTagNotesView).toHaveBeenCalledWith(
			plugin,
			"tag1",
			"source.md",
			false,
		);
	});

	test("does not open TagNotesView when tag results are empty", async () => {
		const indexingService = {
			getNotesWithTag: vi.fn().mockResolvedValue([]),
		};

		await handleTagClick(
			"missing",
			{ sourceFile: { path: "source.md" } } as any,
			indexingService as any,
			{} as any,
		);

		expect(openTagNotesView).not.toHaveBeenCalled();
	});
});
