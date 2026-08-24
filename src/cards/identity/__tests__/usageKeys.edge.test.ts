import { describe, test, expect } from "vitest";
import { getBranchUsageKey, getLinkUsageKey } from "../usageKeys";
import type { CardLinkBranch } from "cards/model";
import type { IndexedLink } from "indexing/model";
import { type TFile } from "obsidian";

vi.mock("obsidian", () => ({
	normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
}));

describe("keyGenerator - empty text key fallback", () => {
	describe("when rawText is empty or whitespace-only for unresolved links", () => {
		test("empty text links from different source files produce different keys", () => {
			const branch1: CardLinkBranch = {
				hop1: {
					rawText: "",
					path: undefined,
					isUnresolved: true,
					sourceFile: { path: "source1.md" } as TFile,
				},
				hop2: [],
			};

			const branch2: CardLinkBranch = {
				hop1: {
					rawText: "   ",
					path: undefined,
					isUnresolved: true,
					sourceFile: { path: "source2.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch1)).toBe("f:source1.md");
			expect(getBranchUsageKey(branch2)).toBe("f:source2.md");
			expect(getBranchUsageKey(branch1)).not.toBe(getBranchUsageKey(branch2));
		});

		test("empty text links from the same source file produce the same key", () => {
			const branch1: CardLinkBranch = {
				hop1: {
					rawText: "",
					path: undefined,
					isUnresolved: true,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			const branch2: CardLinkBranch = {
				hop1: {
					rawText: "   ",
					path: undefined,
					isUnresolved: true,
					sourceFile: { path: "source.md" } as TFile,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch1)).toBe("f:source.md");
			expect(getBranchUsageKey(branch2)).toBe("f:source.md");
			expect(getBranchUsageKey(branch1)).toBe(getBranchUsageKey(branch2));
		});

		test("falls back to 't:' when text is empty and sourceFile.path is absent", () => {
			const branch: CardLinkBranch = {
				hop1: {
					rawText: "",
					path: undefined,
					isUnresolved: true,
					sourceFile: { path: undefined } as any,
				},
				hop2: [],
			};

			expect(getBranchUsageKey(branch)).toBe("t:");
		});
	});

	describe("similar fallback for IndexedLink", () => {
		test("generates key from sourceFile.path when both displayText and rawText are empty", () => {
			const link: IndexedLink = {
				rawText: "",
				path: undefined,
				displayText: undefined,
				isUnresolved: true,
				sourceFile: { path: "notes/file.md" } as any,
			};

			expect(getLinkUsageKey(link)).toBe("f:notes/file.md");
		});

		test("generates key from sourceFile.path when displayText is whitespace-only", () => {
			const link: IndexedLink = {
				rawText: "something",
				path: undefined,
				displayText: "   ",
				isUnresolved: true,
				sourceFile: { path: "notes/other.md" } as any,
			};

			expect(getLinkUsageKey(link)).toBe("f:notes/other.md");
		});

		test("empty links from different source files do not collide", () => {
			const link1: IndexedLink = {
				rawText: "",
				path: undefined,
				displayText: undefined,
				isUnresolved: true,
				sourceFile: { path: "a.md" } as any,
			};

			const link2: IndexedLink = {
				rawText: "",
				path: undefined,
				displayText: undefined,
				isUnresolved: true,
				sourceFile: { path: "b.md" } as any,
			};

			expect(getLinkUsageKey(link1)).not.toBe(getLinkUsageKey(link2));
		});
	});
});
