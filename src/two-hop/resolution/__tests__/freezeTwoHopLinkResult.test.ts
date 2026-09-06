import { describe, expect, test, vi } from "vitest";
import type { IndexedLink, TaggedNote } from "indexing/model";
import type { TwoHopLinkBranch, TwoHopLinkResult } from "two-hop/model";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { freezeTwoHopLinkResult } from "../TwoHopLinkResolver";

function trackItemReads<T>(items: T[]) {
	const onItemRead = vi.fn();
	const array = new Proxy(items, {
		get(target, property, receiver) {
			if (typeof property === "string" && /^\d+$/.test(property)) {
				onItemRead();
			}
			return Reflect.get(target, property, receiver);
		},
	});
	return { array, onItemRead };
}

function createFixture() {
	const file = createMockTFile("origin.md");
	const position = {
		start: { line: 0, col: 0, offset: 0 },
		end: { line: 0, col: 1, offset: 1 },
	};
	const createLink = (): IndexedLink => ({
		rawText: "target",
		path: "target.md",
		isUnresolved: false,
		sourceFile: file,
		position,
	});
	const hop1 = createLink();
	const hop2Link = createLink();
	const backlink = createLink();
	const note: TaggedNote = { file, path: file.path, commonTags: ["tag"] };
	const hop2 = trackItemReads([hop2Link]);
	const branch: TwoHopLinkBranch = { hop1, hop2: hop2.array };
	const branches = trackItemReads([branch]);
	const backlinks = trackItemReads([backlink]);
	const taggedNotes = trackItemReads([note]);
	const result: TwoHopLinkResult = {
		originFile: file,
		branches: branches.array,
		backlinks: backlinks.array,
		taggedNotes: taggedNotes.array,
	};
	return {
		result,
		file,
		position,
		hop1,
		hop2Link,
		backlink,
		note,
		branch,
		branches,
		hop2,
		backlinks,
		taggedNotes,
	};
}

describe("freezeTwoHopLinkResult", () => {
	test("freezes children of shallow-frozen inputs while leaving host objects mutable", () => {
		const fixture = createFixture();
		const { result, branch, note } = fixture;
		Object.freeze(result.branches);
		Object.freeze(branch);
		Object.freeze(branch.hop2);
		Object.freeze(result.backlinks);
		Object.freeze(result.taggedNotes);
		Object.freeze(note);
		Object.freeze(result);

		expect(freezeTwoHopLinkResult(result)).toBe(result);
		for (const value of [
			fixture.hop1,
			fixture.hop2Link,
			fixture.backlink,
			note.commonTags,
		]) {
			expect(Object.isFrozen(value)).toBe(true);
		}
		expect(Object.isFrozen(fixture.file)).toBe(false);
		expect(Object.isFrozen(fixture.position)).toBe(false);
	});

	test("does not read shared array items again when publishing another result", () => {
		const fixture = createFixture();
		freezeTwoHopLinkResult(fixture.result);
		const next = { ...fixture.result };
		expect(freezeTwoHopLinkResult(next)).toBe(next);
		expect(Object.isFrozen(next)).toBe(true);
		for (const tracked of [
			fixture.branches,
			fixture.hop2,
			fixture.backlinks,
			fixture.taggedNotes,
		]) {
			expect(tracked.onItemRead).toHaveBeenCalledTimes(1);
		}
	});

	test("freezes new branches and tags without rescanning shared link arrays", () => {
		const fixture = createFixture();
		freezeTwoHopLinkResult(fixture.result);
		const newBranch = { ...fixture.branch };
		const newNote = { ...fixture.note, commonTags: ["new-tag"] };
		const next: TwoHopLinkResult = {
			...fixture.result,
			branches: [newBranch],
			taggedNotes: [newNote],
		};

		freezeTwoHopLinkResult(next);

		for (const value of [
			next,
			next.branches,
			newBranch,
			next.taggedNotes,
			newNote,
			newNote.commonTags,
		]) {
			expect(Object.isFrozen(value)).toBe(true);
		}
		expect(fixture.hop2.onItemRead).toHaveBeenCalledTimes(1);
		expect(fixture.backlinks.onItemRead).toHaveBeenCalledTimes(1);
		expect(fixture.note.commonTags).toEqual(["tag"]);
	});
});
