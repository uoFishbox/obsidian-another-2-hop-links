import { describe, test, expect, beforeEach } from "vitest";
import { createDeduplicationService } from "../deduplicationService";
import { createDedupState } from "../usageTracker";
import type { DedupState } from "types/deduplication";
import type {
	TwoHopLinkBranch,
	TwoHopIndexedLink,
	TaggedNote,
} from "types/domain";
import { type TFile } from "obsidian";

vi.mock("obsidian", () => ({
	normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
}));

describe("DeduplicationService", () => {
	let service: ReturnType<typeof createScopedDeduplicationService>;

	beforeEach(() => {
		vi.restoreAllMocks();
		service = createScopedDeduplicationService();
	});

	describe("collectUniqueBranches", () => {
		test("all non-duplicate branches are kept", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note1]]",
						path: "note1.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
				{
					hop1: {
						rawText: "[[Note2]]",
						path: "note2.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
			];

			const result = service.collectUniqueBranches(branches);

			expect(result).toHaveLength(2);
			expect(result[0].hop1.path).toBe("note1.md");
			expect(result[1].hop1.path).toBe("note2.md");
		});

		test("only the first branch with same path is kept", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note]]",
						path: "note.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
				{
					hop1: {
						rawText: "[[Note]]",
						path: "note.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
			];

			const result = service.collectUniqueBranches(branches);

			expect(result).toHaveLength(1);
			expect(result[0].hop1.path).toBe("note.md");
		});

		test("same path with different casing is treated as duplicate", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note]]",
						path: "Note.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
				{
					hop1: {
						rawText: "[[note]]",
						path: "note.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
			];

			const result = service.collectUniqueBranches(branches);

			expect(result).toHaveLength(1);
		});

		test("paths differing only in separators are treated as duplicates", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note]]",
						path: "folder/note.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
				{
					hop1: {
						rawText: "[[Note]]",
						path: "folder\\note.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
			];

			const result = service.collectUniqueBranches(branches);

			expect(result).toHaveLength(1);
		});

		test("unresolved links are also deduplicated", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "Unresolved Link",
						path: undefined,
						isUnresolved: true,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
				{
					hop1: {
						rawText: "unresolved link",
						path: undefined,
						isUnresolved: true,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
			];

			const result = service.collectUniqueBranches(branches);

			expect(result).toHaveLength(1);
		});

		test("passing an empty array returns an empty array", () => {
			const result = service.collectUniqueBranches([]);
			expect(result).toHaveLength(0);
		});
	});

	describe("collectUniqueBacklinks", () => {
		test("all non-duplicate backlinks are kept", () => {
			const backlinks: TwoHopIndexedLink[] = [
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "source1.md" } as TFile,
				},
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "source2.md" } as TFile,
				},
			];

			const result = service.collectUniqueBacklinks(backlinks);

			expect(result).toHaveLength(2);
			expect(result[0].sourceFile.path).toBe("source1.md");
			expect(result[1].sourceFile.path).toBe("source2.md");
		});

		test("only the first backlink from the same source file is kept", () => {
			const backlinks: TwoHopIndexedLink[] = [
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "source.md" } as TFile,
				},
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "source.md" } as TFile,
				},
			];

			const result = service.collectUniqueBacklinks(backlinks);

			expect(result).toHaveLength(1);
			expect(result[0].sourceFile.path).toBe("source.md");
		});

		test("passing an empty array returns an empty array", () => {
			const result = service.collectUniqueBacklinks([]);
			expect(result).toHaveLength(0);
		});
	});

	describe("buildFilteredTwoHopBranches", () => {
		test("branches with the same displayKey are merged", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note1]]",
						path: "note1.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [
						{
							rawText: "[[Hop2-1]]",
							path: "hop2-1.md",
							isUnresolved: false,
							sourceFile: { path: "hop2-1-source.md" } as TFile,
						},
					],
				},
				{
					hop1: {
						rawText: "[[note1]]",
						path: "Note1.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [
						{
							rawText: "[[Hop2-2]]",
							path: "hop2-2.md",
							isUnresolved: false,
							sourceFile: { path: "hop2-2-source.md" } as TFile,
						},
					],
				},
			];

			const result = service.buildFilteredTwoHopBranches(branches);

			expect(result).toHaveLength(1);
			expect(result[0].hop2).toHaveLength(2);
		});

		test("results are stable across multiple calls with the same input", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note1]]",
						path: "note1.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [
						{
							rawText: "[[Hop2-1]]",
							path: "hop2-1.md",
							isUnresolved: false,
							sourceFile: { path: "hop2-1-source.md" } as TFile,
						},
					],
				},
				{
					hop1: {
						rawText: "[[Note2]]",
						path: "note2.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [
						{
							rawText: "[[Hop2-2]]",
							path: "hop2-2.md",
							isUnresolved: false,
							sourceFile: { path: "hop2-2-source.md" } as TFile,
						},
					],
				},
			];

			const service1 = createScopedDeduplicationService();
			const service2 = createScopedDeduplicationService();

			const result1 = service1.buildFilteredTwoHopBranches(branches);
			const result2 = service2.buildFilteredTwoHopBranches(branches);

			expect(result2).toHaveLength(result1.length);
			expect(result2.map((b) => b.hop1.path)).toEqual(
				result1.map((b) => b.hop1.path),
			);
		});

		test("passing an empty array returns an empty array", () => {
			const result = service.buildFilteredTwoHopBranches([]);
			expect(result).toHaveLength(0);
		});
	});

	describe("collectUniqueTaggedNotes", () => {
		test("all non-duplicate tagged notes are kept", () => {
			const taggedNotes: TaggedNote[] = [
				{
					file: { path: "note1.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note1.md",
				},
				{
					file: { path: "note2.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note2.md",
				},
			];

			const result = service.collectUniqueTaggedNotes(taggedNotes);

			expect(result).toHaveLength(2);
			expect(result[0].path).toBe("note1.md");
			expect(result[1].path).toBe("note2.md");
		});

		test("only the first tagged note with the same path is kept", () => {
			const taggedNotes: TaggedNote[] = [
				{
					file: { path: "note.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note.md",
				},
				{
					file: { path: "note.md" } as TFile,
					commonTags: ["#tag2"],
					path: "note.md",
				},
			];

			const result = service.collectUniqueTaggedNotes(taggedNotes);

			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("note.md");
		});

		test("tagged notes with pre-set usageKey are correctly deduplicated", () => {
			const taggedNotes: TaggedNote[] = [
				{
					file: { path: "note.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note.md",
					usageKey: "f:note.md",
				},
				{
					file: { path: "note.md" } as TFile,
					commonTags: ["#tag2"],
					path: "note.md",
					usageKey: "f:note.md",
				},
			];

			const result = service.collectUniqueTaggedNotes(taggedNotes);

			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("note.md");
		});

		test("passing an empty array returns an empty array", () => {
			const result = service.collectUniqueTaggedNotes([]);
			expect(result).toHaveLength(0);
		});
	});

	describe("tests for side effects from call order", () => {
		test("cross-domain consumption only occurs when returned state is passed explicitly", () => {
			const explicitService = createDeduplicationService();
			const initialState = createDedupState();
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[SharedFile]]",
						path: "shared.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [],
				},
			];
			const backlinks: TwoHopIndexedLink[] = [
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "shared.md" } as TFile,
				},
			];

			const branchResult = explicitService.collectUniqueBranches(
				initialState,
				branches,
			);
			const independentBacklinks = explicitService.collectUniqueBacklinks(
				initialState,
				backlinks,
			);
			const transitionedBacklinks =
				explicitService.collectUniqueBacklinks(
					branchResult.state,
					backlinks,
				);

			expect(independentBacklinks.items).toHaveLength(1);
			expect(transitionedBacklinks.items).toHaveLength(0);
			expect(initialState.usedKeys).toHaveLength(0);
		});

		test("same file is deduplicated across different domains", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[SharedFile]]",
						path: "shared.md",
						isUnresolved: false,
						sourceFile: { path: "source1.md" } as TFile,
					},
					hop2: [],
				},
			];

			const backlinks: TwoHopIndexedLink[] = [
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "shared.md" } as TFile,
				},
			];

			const service1 = createScopedDeduplicationService();
			const uniqueBacklinks1 = service1.collectUniqueBacklinks(backlinks);
			const uniqueBranches1 = service1.collectUniqueBranches(branches);
			expect(uniqueBacklinks1).toHaveLength(1);
			expect(uniqueBranches1).toHaveLength(0);

			const service2 = createScopedDeduplicationService();
			const uniqueBranches2 = service2.collectUniqueBranches(branches);
			const uniqueBacklinks2 = service2.collectUniqueBacklinks(backlinks);
			expect(uniqueBranches2).toHaveLength(1);
			expect(uniqueBacklinks2).toHaveLength(0);
		});

		test("hop2 from buildFilteredTwoHopBranches is excluded from subsequent backlink collection", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note1]]",
						path: "note1.md",
						isUnresolved: false,
						sourceFile: { path: "source.md" } as TFile,
					},
					hop2: [
						{
							rawText: "[[Hop2]]",
							path: "hop2.md",
							isUnresolved: false,
							sourceFile: { path: "hop2-source.md" } as TFile,
						},
					],
				},
			];

			const backlinks: TwoHopIndexedLink[] = [
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "hop2-source.md" } as TFile,
				},
			];

			const filteredBranches =
				service.buildFilteredTwoHopBranches(branches);
			expect(filteredBranches).toHaveLength(1);

			const uniqueBacklinks = service.collectUniqueBacklinks(backlinks);
			expect(uniqueBacklinks).toHaveLength(0);
		});
	});

	describe("real usage scenario", () => {
		test("processing multiple domains in order produces no duplicates and keeps what is needed", () => {
			const branches: TwoHopLinkBranch[] = [
				{
					hop1: {
						rawText: "[[Note1]]",
						path: "note1.md",
						isUnresolved: false,
						sourceFile: { path: "source1.md" } as TFile,
					},
					hop2: [
						{
							rawText: "[[Hop2-1]]",
							path: "hop2-1.md",
							isUnresolved: false,
							sourceFile: { path: "source2.md" } as TFile,
						},
					],
				},
				{
					hop1: {
						rawText: "[[Note2]]",
						path: "note2.md",
						isUnresolved: false,
						sourceFile: { path: "source3.md" } as TFile,
					},
					hop2: [],
				},
			];

			const backlinks: TwoHopIndexedLink[] = [
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "note1.md" } as TFile,
				},
				{
					rawText: "[[Target]]",
					path: "target.md",
					isUnresolved: false,
					sourceFile: { path: "source4.md" } as TFile,
				},
			];

			const taggedNotes: TaggedNote[] = [
				{
					file: { path: "note1.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note1.md",
				},
				{
					file: { path: "note2.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note2.md",
				},
				{
					file: { path: "note3.md" } as TFile,
					commonTags: ["#tag1"],
					path: "note3.md",
				},
			];

			const uniqueBranches = service.collectUniqueBranches(branches);
			expect(uniqueBranches).toHaveLength(2);

			const filteredBranches =
				service.buildFilteredTwoHopBranches(branches);
			expect(filteredBranches).toHaveLength(1);

			const uniqueBacklinks = service.collectUniqueBacklinks(backlinks);
			expect(uniqueBacklinks).toHaveLength(1);
			expect(uniqueBacklinks[0].sourceFile.path).toBe("source4.md");

			const uniqueTaggedNotes =
				service.collectUniqueTaggedNotes(taggedNotes);
			expect(uniqueTaggedNotes).toHaveLength(1);
			expect(uniqueTaggedNotes[0].path).toBe("note3.md");
		});
	});
});

function createScopedDeduplicationService() {
	const service = createDeduplicationService();
	let state = createDedupState();

	function apply<T>(
		operation: (state: DedupState) => { state: DedupState; items: T[] },
	): T[] {
		const result = operation(state);
		state = result.state;
		return result.items;
	}

	return {
		collectUniqueBranches: (branches: TwoHopLinkBranch[]) =>
			apply((current) =>
				service.collectUniqueBranches(current, branches),
			),
		collectUniqueBacklinks: (backlinks: TwoHopIndexedLink[]) =>
			apply((current) =>
				service.collectUniqueBacklinks(current, backlinks),
			),
		buildFilteredTwoHopBranches: (branches: TwoHopLinkBranch[]) =>
			apply((current) =>
				service.buildFilteredTwoHopBranches(current, branches),
			),
		collectUniqueTaggedNotes: (taggedNotes: TaggedNote[]) =>
			apply((current) =>
				service.collectUniqueTaggedNotes(current, taggedNotes),
			),
	};
}
