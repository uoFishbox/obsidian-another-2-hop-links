import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import type {
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
} from "types/domain";
import {
	getViewItemKey,
	type ViewItem,
} from "application/presenters";

describe("getViewItemKey", () => {
	it("returns the tagged note path", () => {
		const item: ViewItem = {
			type: "taggedNote",
			data: {
				path: "notes/tagged.md",
				file: {
					path: "notes/tagged.md",
					stat: { ctime: 0, mtime: 0, size: 0 },
				} as TFile,
				commonTags: [],
			} as TaggedNote,
		};

		expect(getViewItemKey(item)).toBe("notes/tagged.md");
	});

	it("returns the file path", () => {
		const item: ViewItem = {
			type: "file",
			data: {
				path: "notes/file.md",
			} as TFile,
		};

		expect(getViewItemKey(item)).toBe("notes/file.md");
	});

	it("returns the backlink source file path", () => {
		const data: TwoHopIndexedLink = {
			sourceFile: {
				path: "notes/source.md",
				stat: { ctime: 0, mtime: 0, size: 0 },
			} as TFile,
			rawText: "source",
			displayText: "source",
			isUnresolved: false,
		} as TwoHopIndexedLink;
		const item: ViewItem = {
			type: "backlink",
			data,
		};

		expect(getViewItemKey(item)).toBe("notes/source.md");
	});

	it("returns the branch hop1 path when present", () => {
		const data: TwoHopLinkBranch = {
			hop1: {
				path: "notes/hop1.md",
				rawText: "hop1",
				displayText: "hop1",
				isUnresolved: false,
			} as TwoHopIndexedLink,
			hop2: [],
		};
		const item: ViewItem = {
			type: "branch",
			data,
		};

		expect(getViewItemKey(item)).toBe("notes/hop1.md");
	});

	it("returns the branch lookup path when the hop1 path is unresolved", () => {
		const data: TwoHopLinkBranch = {
			hop1: {
				path: undefined,
				lookupPath: "notes/missing.md",
				rawText: "Missing",
				displayText: "Missing",
				isUnresolved: true,
			} as TwoHopIndexedLink,
			hop2: [],
		};
		const item: ViewItem = {
			type: "branch",
			data,
		};

		expect(getViewItemKey(item)).toBe("notes/missing.md");
	});

	it("returns the new link lookup path when available", () => {
		const item: ViewItem = {
			type: "newLink",
			data: {
				sourceFile: {
					path: "notes/source.md",
					stat: { ctime: 0, mtime: 0, size: 0 },
				} as TFile,
				rawText: "Missing",
				lookupPath: "notes/missing.md",
				path: undefined,
				isUnresolved: true,
			} as TwoHopIndexedLink,
		};

		expect(getViewItemKey(item)).toBe("notes/missing.md");
	});



});
