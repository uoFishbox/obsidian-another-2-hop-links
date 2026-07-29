import { describe, expect, it } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { TwoHopIndexedLink, TwoHopLinkResult } from "types/domain";
import {
	decideDataUpdateAction,
	getPreviewInvalidation,
	shouldReloadForUpdate,
} from "../dataUpdateReloadDecider";

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
		indexVersion: 1,
		affectedPaths: overrides.affectedPaths ?? [],
		affectedLookupKeys: overrides.affectedLookupKeys ?? [],
		affectedTags: overrides.affectedTags ?? [],
		affectedLinkSourcePaths: overrides.affectedLinkSourcePaths ?? [],
		affectedTagSourcePaths: overrides.affectedTagSourcePaths ?? [],
	};
}

describe("dataUpdateReloadDecider", () => {
	const decider = {
		decide: decideDataUpdateAction,
		getPreviewInvalidation,
		shouldReloadForUpdate,
	};

	it("does not reload for unrelated path and lookup updates", () => {
		const currentFile = createMockTFile("current.md");
		const data = createLinkResultWithBranch(currentFile.path, "target.md");

		expect(
			decider.shouldReloadForUpdate({
				currentFile,
				data,
				context: {
					indexVersion: 2,
					affectedPaths: ["other.md"],
					affectedLookupKeys: ["other.md"],
				},
			}),
		).toBe(false);
		expect(
			decider.getPreviewInvalidation({
				currentFile,
				data,
				context: {
					indexVersion: 2,
					affectedPaths: ["other.md"],
					affectedLookupKeys: ["other.md"],
				},
			}),
		).toBeUndefined();
	});

	it("reloads for affected branch lookup keys", () => {
		const currentFile = createMockTFile("current.md");
		const data = createLinkResultWithBranch(currentFile.path, "target.md");

		expect(
			decider.shouldReloadForUpdate({
				currentFile,
				data,
				context: {
					indexVersion: 3,
					affectedLookupKeys: ["target.md"],
				},
			}),
		).toBe(true);
	});

	it("reloads and invalidates previews for displayed target path updates", () => {
		const currentFile = createMockTFile("current.md");
		const data = createLinkResultWithBranch(currentFile.path, "target.md");
		const input = {
			currentFile,
			data,
			context: {
				indexVersion: 4,
				affectedPaths: ["target.md"],
				affectedLookupKeys: ["unrelated.md"],
			},
		};

		expect(decider.shouldReloadForUpdate(input)).toBe(true);
		expect(decider.getPreviewInvalidation(input)).toEqual(new Set(["target.md"]));
	});

	it("reloads when a displayed backlink source path changes", () => {
		const currentFile = createMockTFile("current.md");
		const data = createLinkResultWithBacklink(currentFile.path, "src-current.md");

		expect(
			decider.shouldReloadForUpdate({
				currentFile,
				data,
				context: {
					indexVersion: 5,
					affectedPaths: ["src-current.md"],
					affectedLookupKeys: ["unrelated.md"],
				},
			}),
		).toBe(true);
	});

	describe("decide()", () => {
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
					indexVersion: 1,
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
				context: createFullContext({
					affectedPaths: ["other.md"],
					affectedTags: ["unrelated"],
					affectedLinkSourcePaths: [],
					affectedTagSourcePaths: ["other.md"],
				}),
			});

			expect(action.kind).toBe("none");
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
