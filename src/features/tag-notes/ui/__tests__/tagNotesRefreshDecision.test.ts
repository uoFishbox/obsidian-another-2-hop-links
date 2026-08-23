import { describe, expect, it, vi } from "vitest";
import { shouldRefreshTagNotesForContext } from "features/tag-notes/ui/tagNotesRefreshDecision";

describe("shouldRefreshTagNotesForContext", () => {
	it("refreshes only when an index update can affect the current tag result", () => {
		const hasCurrentItemPath = vi.fn((path: string) => path === "notes/alpha.md");
		const baseInput = {
			tagFeaturesEnabled: true,
			tag: "alpha",
			sourcePath: "source.md",
			hasCurrentItemPath,
		};

		expect(
			shouldRefreshTagNotesForContext({
				...baseInput,
				context: { affectedTags: ["beta"], affectedPaths: ["other.md"] },
			}),
		).toBe(false);
		expect(
			shouldRefreshTagNotesForContext({
				...baseInput,
				context: { affectedTags: ["alpha"] },
			}),
		).toBe(true);
		expect(
			shouldRefreshTagNotesForContext({
				...baseInput,
				context: { affectedPaths: ["source.md"] },
			}),
		).toBe(true);
		expect(
			shouldRefreshTagNotesForContext({
				...baseInput,
				context: { affectedPaths: ["notes/alpha.md"] },
			}),
		).toBe(true);
		expect(
			shouldRefreshTagNotesForContext({
				...baseInput,
				tagFeaturesEnabled: false,
			}),
		).toBe(false);
	});
});
