import { describe, expect, test, vi } from "vitest";
import type { TFile } from "obsidian";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch } from "two-hop/model";
import { deduplicateLinks, deduplicateTaggedNotes } from "../deduplicateDisplayItems";
import { createDedupState } from "../usageTracker";
import * as keyGenerator from "cards/identity/usageKeys";

vi.mock("obsidian", () => ({
	normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
}));

function createLink(
	path: string | undefined,
	sourcePath: string,
	isUnresolved = false,
): IndexedLink {
	return {
		rawText: path ?? "Unresolved Link",
		path,
		isUnresolved,
		sourceFile: { path: sourcePath } as TFile,
	};
}

function createBranch(
	path: string | undefined,
	hop2: readonly IndexedLink[] = [],
	isUnresolved = false,
): TwoHopLinkBranch {
	return {
		hop1: createLink(path, "origin.md", isUnresolved),
		hop2,
	};
}

function createTaggedNote(path: string, usageKey?: string): TaggedNote {
	return {
		file: { path } as TFile,
		commonTags: ["#tag"],
		path,
		usageKey,
	};
}

describe("deduplicateLinks", () => {
	test("keeps unique branch and backlink arrays by reference", () => {
		const branches = [createBranch("one.md"), createBranch("two.md")];
		const backlinks = [createLink("target.md", "backlink.md")];

		const result = deduplicateLinks(createDedupState(), branches, backlinks);

		expect(result.data.branches).toBe(branches);
		expect(result.data.backlinks).toBe(backlinks);
	});

	test("keeps the first hop1 and merges duplicate branch hop2 in source order", () => {
		const firstHop2 = createLink("first-target.md", "first-source.md");
		const repeatedHop2 = createLink("repeat-target.md", "first-source.md");
		const secondHop2 = createLink("second-target.md", "second-source.md");
		const first = createBranch("Note.md", [firstHop2]);
		const duplicate = createBranch("note.md", [repeatedHop2, secondHop2]);

		const result = deduplicateLinks(createDedupState(), [first, duplicate], []);

		expect(result.data.branches).toEqual([first]);
		expect(result.data.twoHopBranches).toEqual([
			{ hop1: first.hop1, hop2: [firstHop2, secondHop2] },
		]);
	});

	test("uses branch then backlink then hop2 precedence", () => {
		const blockedByBacklink = createLink("hop-target.md", "backlink.md");
		const remainingHop2 = createLink("hop-target-2.md", "hop-only.md");
		const branch = createBranch("branch.md", [blockedByBacklink, remainingHop2]);
		const blockedByBranch = createLink("target.md", "branch.md");
		const backlink = createLink("target-2.md", "backlink.md");

		const result = deduplicateLinks(
			createDedupState(),
			[branch],
			[blockedByBranch, backlink],
		);

		expect(result.data.branches).toEqual([branch]);
		expect(result.data.backlinks).toEqual([backlink]);
		expect(result.data.twoHopBranches).toEqual([
			{ hop1: branch.hop1, hop2: [remainingHop2] },
		]);
	});

	test("consumes interleaved duplicate branches in canonical order without mutating inputs", () => {
		const sharedFromA = createLink("a-target.md", "shared.md");
		const sharedFromB = createLink("b-target.md", "shared.md");
		const onlyB = createLink("b-target.md", "only-b.md");
		const firstA = Object.freeze(createBranch("A.md"));
		const branchB = Object.freeze(
			createBranch("B.md", Object.freeze([sharedFromB, onlyB])),
		);
		const laterA = Object.freeze(
			createBranch("a.md", Object.freeze([sharedFromA, sharedFromA])),
		);
		const branches = Object.freeze([firstA, branchB, laterA]);
		const state = { usedKeys: new Set(["f:prior.md"]) };

		const result = deduplicateLinks(state, branches, Object.freeze([]));

		expect(result.data.branches).toEqual([firstA, branchB]);
		expect(result.data.twoHopBranches).toEqual([
			{ hop1: firstA.hop1, hop2: [sharedFromA] },
			{ hop1: branchB.hop1, hop2: [onlyB] },
		]);
		expect(result.data.twoHopBranches[0].hop1).toBe(firstA.hop1);
		expect(result.data.twoHopBranches[0].hop2[0]).toBe(sharedFromA);
		expect(branchB.hop2).toEqual([sharedFromB, onlyB]);
		expect(laterA.hop2).toEqual([sharedFromA, sharedFromA]);
		expect(state.usedKeys).toEqual(new Set(["f:prior.md"]));
		expect(result.state.usedKeys).toEqual(
			new Set(["f:prior.md", "f:a.md", "f:b.md", "f:shared.md", "f:only-b.md"]),
		);
	});

	test("keeps hop2 from a blocked resolved branch when an unresolved duplicate is displayed", () => {
		const firstHop2 = createLink("target.md", "first.md");
		const laterHop2 = createLink("target.md", "later.md");
		const resolved = createBranch("shared.md", [firstHop2]);
		const unresolved = createBranch("shared.md", [laterHop2], true);
		const state = { usedKeys: new Set(["f:shared.md"]) };

		const result = deduplicateLinks(state, [resolved, unresolved], []);

		expect(result.data.branches).toEqual([unresolved]);
		expect(result.data.twoHopBranches).toEqual([
			{ hop1: resolved.hop1, hop2: [firstHop2, laterHop2] },
		]);
	});

	test("computes branch keys once per input branch", () => {
		const getBranchKeys = vi.spyOn(keyGenerator, "getBranchKeys");
		const branches = [createBranch("one.md"), createBranch("one.md")];

		deduplicateLinks(createDedupState(), branches, []);

		expect(getBranchKeys).toHaveBeenCalledTimes(branches.length);
	});

	test("preserves displayKey and usageKey distinction for unresolved branches", () => {
		const resolved = createBranch("shared.md");
		const unresolved = createBranch("shared.md", [], true);
		const initialState = { usedKeys: new Set(["f:shared.md"]) };

		const result = deduplicateLinks(initialState, [resolved, unresolved], []);

		expect(result.data.branches).toEqual([unresolved]);
		expect(result.data.twoHopBranches).toEqual([]);
	});

	test("does not mutate the supplied state", () => {
		const initialState = createDedupState();

		const result = deduplicateLinks(initialState, [createBranch("branch.md")], []);

		expect(initialState.usedKeys.size).toBe(0);
		expect(result.state).not.toBe(initialState);
		expect(result.state.usedKeys).toContain("f:branch.md");
	});

	test("returns empty input arrays by reference", () => {
		const branches: TwoHopLinkBranch[] = [];
		const backlinks: IndexedLink[] = [];

		const result = deduplicateLinks(createDedupState(), branches, backlinks);

		expect(result.data.branches).toBe(branches);
		expect(result.data.backlinks).toBe(backlinks);
		expect(result.data.twoHopBranches).toEqual([]);
	});
});

describe("deduplicateTaggedNotes", () => {
	test("deduplicates within tags and against prior link state", () => {
		const state = { usedKeys: new Set(["f:link.md"]) };
		const first = createTaggedNote("tag.md");
		const duplicate = createTaggedNote("tag.md");

		const result = deduplicateTaggedNotes(state, [
			createTaggedNote("link.md"),
			first,
			duplicate,
		]);

		expect(result).toEqual([first]);
		expect(state.usedKeys).toEqual(new Set(["f:link.md"]));
	});

	test("honors a precomputed usageKey", () => {
		const state = { usedKeys: new Set(["custom:key"]) };

		const result = deduplicateTaggedNotes(state, [
			createTaggedNote("tag.md", "custom:key"),
		]);

		expect(result).toEqual([]);
		expect(state.usedKeys).toEqual(new Set(["custom:key"]));
	});

	test("returns an empty input by reference without changing state", () => {
		const state = createDedupState();
		const notes: TaggedNote[] = [];

		const result = deduplicateTaggedNotes(state, notes);

		expect(result).toBe(notes);
		expect(state.usedKeys.size).toBe(0);
	});

	test("reuses unique input and only looks up prior keys without enumerating them", () => {
		const usedKeys = new Set(["f:prior.md"]);
		const iterator = vi.spyOn(usedKeys, Symbol.iterator);
		const notes = Object.freeze([
			createTaggedNote("one.md"),
			createTaggedNote("two.md"),
		]);

		expect(deduplicateTaggedNotes({ usedKeys }, notes)).toBe(notes);
		expect(iterator).not.toHaveBeenCalled();
		expect(usedKeys.size).toBe(1);
		expect(usedKeys.has("f:prior.md")).toBe(true);
	});
});
