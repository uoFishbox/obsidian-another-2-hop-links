import type { CachedMetadata, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import { collectResolverDependencies } from "features/two-hop/domain/ResolverDependencies";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TwoHopIndexedLink, TwoHopLinkResult } from "types/domain";
import { decideDataUpdateAction } from "../dataUpdateReloadDecider";

function createLinkResultWithBranch(
	originPath: string,
	branchTargetPath: string,
	hop2Paths: string[] = [],
): TwoHopLinkResult {
	const originFile = createMockTFile(originPath);
	const branchTargetFile = createMockTFile(branchTargetPath);

	return {
		originFile,
		branches: [
			{
				hop1: {
					rawText: branchTargetFile.basename,
					path: branchTargetFile.path,
					isUnresolved: false,
					sourceFile: originFile,
				},
				hop2: hop2Paths.map((p) => ({
					rawText: createMockTFile(p).basename,
					path: branchTargetPath,
					isUnresolved: false,
					sourceFile: createMockTFile(p),
				})),
			},
		],
		backlinks: [],
		taggedNotes: [],
	};
}

function createLinkResultWithTags(
	originPath: string,
	taggedNotes: { path: string; tags: string[] }[],
): TwoHopLinkResult {
	const originFile = createMockTFile(originPath);

	return {
		originFile,
		branches: [],
		backlinks: [],
		taggedNotes: taggedNotes.map((n) => ({
			file: createMockTFile(n.path),
			commonTags: n.tags,
			path: n.path,
		})),
	};
}

function createLinkResultWithBacklink(
	originPath: string,
	backlinkPath: string,
): TwoHopLinkResult {
	const sourceFile = createMockTFile(backlinkPath);
	const backlink: TwoHopIndexedLink = {
		rawText: sourceFile.basename,
		path: sourceFile.path,
		isUnresolved: false,
		sourceFile,
	};

	return {
		originFile: createMockTFile(originPath),
		branches: [],
		backlinks: [backlink],
		taggedNotes: [],
	};
}

function createFullContext(
	overrides: {
		affectedPaths?: string[];
		affectedLookupKeys?: string[];
		affectedTags?: string[];
		affectedLinkSourcePaths?: string[];
		affectedTagSourcePaths?: string[];
	} = {},
) {
	return {
		affectedPaths: overrides.affectedPaths ?? [],
		affectedLookupKeys: overrides.affectedLookupKeys ?? [],
		affectedTags: overrides.affectedTags ?? [],
		affectedLinkSourcePaths: overrides.affectedLinkSourcePaths ?? [],
		affectedTagSourcePaths: overrides.affectedTagSourcePaths ?? [],
	};
}

interface TestReloadDecisionInput {
	currentFile: TFile | undefined;
	data: TwoHopLinkResult | undefined;
	context?: DataUpdateContext;
	originTags?: string[];
}

function createDependencyInput(input: TestReloadDecisionInput) {
	const { currentFile, data, context, originTags = [] } = input;
	const originMetadata = {
		frontmatter: { tags: originTags },
	} as unknown as CachedMetadata;

	return {
		currentFile,
		dependencies: data
			? collectResolverDependencies(originMetadata, data)
			: undefined,
		context,
	};
}

describe("dataUpdateReloadDecider", () => {
	const decider = {
		decide: (input: TestReloadDecisionInput) =>
			decideDataUpdateAction(createDependencyInput(input)),
	};

	describe("decide()", () => {
		it("reloads conservatively when the dependency snapshot is unavailable", () => {
			const currentFile = createMockTFile("origin.md");
			const action = decideDataUpdateAction({
				currentFile,
				dependencies: undefined,
				context: createFullContext({
					affectedPaths: ["unrelated.md"],
				}),
			});

			expect(action).toEqual({
				kind: "reload",
				previewInvalidation: "all",
			});
		});

		it("returns reload when an unknown note newly acquires an origin tag", () => {
			const currentFile = createMockTFile("origin.md");
			const data = createLinkResultWithTags(currentFile.path, []);

			const action = decider.decide({
				currentFile,
				data,
				originTags: ["project"],
				context: createFullContext({
					affectedPaths: ["candidate.md"],
					affectedTags: ["project"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["candidate.md"],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("returns preview-only for displayed hop2 card body change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md", [
				"hop2.md",
			]);

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["hop2.md"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("preview-only");
			expect(action.previewInvalidation).toEqual(new Set(["hop2.md"]));
		});

		it("returns preview-only for displayed hop1 card body change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["target.md"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("preview-only");
			expect(action.previewInvalidation).toEqual(new Set(["target.md"]));
		});

		it("returns reload for displayed hop1 card outgoing links change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["target.md"],
					affectedLookupKeys: ["new-child.md"],
					affectedLinkSourcePaths: ["target.md"],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("reload");
			expect(action.previewInvalidation).toEqual(new Set(["target.md"]));
		});

		it("returns preview-only for backlink source body change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBacklink(
				currentFile.path,
				"backlink-source.md",
			);

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["backlink-source.md"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("preview-only");
			expect(action.previewInvalidation).toEqual(new Set(["backlink-source.md"]));
		});

		it("returns reload for backlink source link relation change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBacklink(
				currentFile.path,
				"backlink-source.md",
			);

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["backlink-source.md"],
					affectedLinkSourcePaths: ["backlink-source.md"],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("returns none for unrelated file body change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["unrelated.md"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("none");
		});

		it("returns reload when affectedLookupKeys matches relevant lookup key", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedLookupKeys: ["target.md"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("returns reload for backward compatibility when context is old format", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: {
					affectedPaths: ["target.md"],
					affectedLookupKeys: [],
					affectedTags: [],
					// affectedLinkSourcePaths and affectedTagSourcePaths are undefined
				},
			});

			expect(action.kind).toBe("reload");
		});

		it("returns reload when currentFile outgoing links change", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["current.md"],
					affectedLinkSourcePaths: ["current.md"],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		// --- A. body-only edit of tagged file ---
		it("returns preview-only for tagged file body-only edit", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithTags(currentFile.path, [
				{ path: "note.md", tags: ["project"] },
			]);

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["note.md"],
					affectedTags: [],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("preview-only");
			expect(action.previewInvalidation).toEqual(new Set(["note.md"]));
		});

		// --- B. unrelated tagged file body edit ---
		it("returns none for unrelated tagged file body edit", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "A.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["B.md"],
					affectedTags: [],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: [],
				}),
			});

			expect(action.kind).toBe("none");
		});

		// --- C. tag membership add/remove ---
		it("returns reload when tag membership changes for relevant tag", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithTags(currentFile.path, [
				{ path: "note.md", tags: ["project"] },
			]);

			const action = decider.decide({
				currentFile,
				data,
				originTags: ["project"],
				context: createFullContext({
					affectedPaths: ["note.md"],
					affectedTags: ["project"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["note.md"],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("returns none when tag membership changes for unrelated tag", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithTags(currentFile.path, [
				{ path: "note.md", tags: ["project"] },
			]);

			const action = decider.decide({
				currentFile,
				data,
				originTags: ["project"],
				context: createFullContext({
					affectedPaths: ["other.md"],
					affectedTags: ["unrelated"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["other.md"],
				}),
			});

			expect(action.kind).toBe("none");
		});

		it("returns reload when a displayed note loses an origin tag", () => {
			const currentFile = createMockTFile("origin.md");
			const data = createLinkResultWithTags(currentFile.path, [
				{ path: "candidate.md", tags: ["project"] },
			]);

			const action = decider.decide({
				currentFile,
				data,
				originTags: ["project"],
				context: createFullContext({
					affectedPaths: ["candidate.md"],
					affectedTags: ["project"],
					affectedTagSourcePaths: ["candidate.md"],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("keeps all origin tags when a candidate acquires one of multiple tags", () => {
			const currentFile = createMockTFile("origin.md");
			const data = createLinkResultWithTags(currentFile.path, []);

			const action = decider.decide({
				currentFile,
				data,
				originTags: ["project", "typescript"],
				context: createFullContext({
					affectedPaths: ["candidate.md"],
					affectedTags: ["typescript"],
					affectedTagSourcePaths: ["candidate.md"],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("uses TagIndex normalization for case, hash, and nested tags", () => {
			const currentFile = createMockTFile("origin.md");
			const data = createLinkResultWithTags(currentFile.path, []);

			const projectAction = decider.decide({
				currentFile,
				data,
				originTags: ["#Project", "Nested/Tag"],
				context: createFullContext({
					affectedTags: ["project"],
					affectedTagSourcePaths: ["candidate.md"],
				}),
			});
			const nestedAction = decider.decide({
				currentFile,
				data,
				originTags: ["#Project", "Nested/Tag"],
				context: createFullContext({
					affectedTags: ["nested/tag"],
					affectedTagSourcePaths: ["candidate.md"],
				}),
			});

			expect(projectAction.kind).toBe("reload");
			expect(nestedAction.kind).toBe("reload");
		});

		it("returns reload when tag membership changes and tagSourcePaths intersects relevant paths", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithTags(currentFile.path, [
				{ path: "note.md", tags: ["project"] },
			]);

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["note.md"],
					affectedTags: [],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["note.md"],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("returns none when tagSourcePaths does not intersect relevant paths", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["unrelated.md"],
					affectedTags: [],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["unrelated.md"],
				}),
			});

			expect(action.kind).toBe("none");
		});

		// --- D. rename of tagged file ---
		it("returns reload when renamed file is in relevant paths", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithTags(currentFile.path, [
				{ path: "new.md", tags: ["project"] },
			]);

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["old.md", "new.md"],
					affectedTags: ["project"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["old.md", "new.md"],
				}),
			});

			expect(action.kind).toBe("reload");
		});

		it("returns none when renamed file is not in relevant paths", () => {
			const currentFile = createMockTFile("current.md");
			const data = createLinkResultWithBranch(currentFile.path, "target.md");

			const action = decider.decide({
				currentFile,
				data,
				context: createFullContext({
					affectedPaths: ["old.md", "new.md"],
					affectedTags: ["project"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["old.md", "new.md"],
				}),
			});

			expect(action.kind).toBe("none");
		});
	});
});
