import { describe, expect, it } from "vitest";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import {
	hasSameTwoHopBranchCard,
	hasSameBacklinkIndexedLink,
	hasSameBacklinkIndexedLinks,
	hasSameTaggedNote,
	hasSameTaggedNotes,
	hasSameTwoHopIndexedLink,
	hasSameTwoHopIndexedLinks,
	hasSameViewItemSource,
} from "ui/utils/twohopEquality";
import type { ViewItem } from "application/presenters";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";

function createLink(overrides: Partial<TwoHopIndexedLink> = {}): TwoHopIndexedLink {
	return {
		rawText: "[[target]]",
		path: "target.md",
		displayText: "target",
		isUnresolved: false,
		sourceFile: createMockTFile("source.md"),
		position: {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: 0, col: 9, offset: 9 },
		},
		backlinkCount: 2,
		...overrides,
	} as TwoHopIndexedLink;
}

function createBranch(
	overrides: Partial<TwoHopLinkBranch> = {},
	linkOverrides: Partial<TwoHopIndexedLink> = {},
): TwoHopLinkBranch {
	return {
		hop1: createLink(linkOverrides),
		hop2: [createLink({ sourceFile: createMockTFile("child.md") })],
		...overrides,
	} as TwoHopLinkBranch;
}

function createTaggedNote(overrides: Partial<TaggedNote> = {}): TaggedNote {
	return {
		file: createMockTFile("notes/tagged.md"),
		commonTags: ["alpha", "beta"],
		path: "notes/tagged.md",
		usageKey: "tag:alpha",
		position: {
			start: { line: 1, col: 2, offset: 10 },
			end: { line: 1, col: 8, offset: 16 },
		},
		...overrides,
	} as TaggedNote;
}

describe("twohopEquality", () => {
	it("returns before reading identical object references", () => {
		const throwOnRead = {
			get(): never {
				throw new Error("identical references must not be read");
			},
		};
		const link = new Proxy(createLink(), throwOnRead);
		const branch = new Proxy(createBranch(), throwOnRead);
		const taggedNote = new Proxy(createTaggedNote(), throwOnRead);
		const viewItem = new Proxy(
			{ type: "backlink", data: link } as ViewItem,
			throwOnRead,
		);

		expect(hasSameTwoHopIndexedLink(link, link)).toBe(true);
		expect(hasSameBacklinkIndexedLink(link, link)).toBe(true);
		expect(hasSameTwoHopBranchCard(branch, branch)).toBe(true);
		expect(hasSameTaggedNote(taggedNote, taggedNote)).toBe(true);
		expect(hasSameViewItemSource(viewItem, viewItem)).toBe(true);
	});

	it("treats identical two-hop links as equal", () => {
		const current = createLink();
		const next = createLink({
			sourceFile: current.sourceFile,
		});

		expect(hasSameTwoHopIndexedLink(current, next)).toBe(true);
	});

	it("treats changed fields as different", () => {
		const current = createLink();
		const next = createLink({
			sourceFile: current.sourceFile,
			displayText: "different",
		});

		expect(hasSameTwoHopIndexedLink(current, next)).toBe(false);
	});

	it("treats changed lookupPath as different", () => {
		const current = createLink({
			path: undefined,
			lookupPath: "missing-a.md",
			isUnresolved: true,
		});
		const next = createLink({
			sourceFile: current.sourceFile,
			path: undefined,
			lookupPath: "missing-b.md",
			isUnresolved: true,
		});

		expect(hasSameTwoHopIndexedLink(current, next)).toBe(false);
	});

	it("compares two-hop link arrays by item", () => {
		const sourceFile = createMockTFile("source.md");
		const current = [createLink({ sourceFile })];
		const next = [createLink({ sourceFile })];
		const different = [createLink({ sourceFile, backlinkCount: 3 })];

		expect(hasSameTwoHopIndexedLinks(current, next)).toBe(true);
		expect(hasSameTwoHopIndexedLinks(current, different)).toBe(false);
	});

	it("treats backlinks with moved positions as equal", () => {
		const sourceFile = createMockTFile("source.md");
		const current = createLink({
			sourceFile,
			position: {
				start: { line: 0, col: 0, offset: 10 },
				end: { line: 0, col: 9, offset: 19 },
			},
		});
		const next = createLink({
			sourceFile,
			position: {
				start: { line: 2, col: 0, offset: 40 },
				end: { line: 2, col: 9, offset: 49 },
			},
		});

		expect(hasSameBacklinkIndexedLink(current, next)).toBe(true);
	});

	it("treats backlinks with changed keys as different", () => {
		const sourceFile = createMockTFile("source.md");
		const current = [createLink({ sourceFile, key: "frontmatter.a" })];
		const next = [createLink({ sourceFile, key: "frontmatter.b" })];

		expect(hasSameBacklinkIndexedLinks(current, next)).toBe(false);
	});

	it("treats omitted backlink fields like their serialized defaults", () => {
		const sourceFile = createMockTFile("source.md");
		const current = createLink({
			sourceFile,
			path: undefined,
			lookupPath: undefined,
			displayText: undefined,
			key: undefined,
			backlinkCount: undefined,
			isUnresolved: undefined,
		});
		const next = createLink({
			sourceFile,
			path: "",
			lookupPath: "",
			displayText: "",
			key: "",
			backlinkCount: -1,
			isUnresolved: false,
		});

		expect(hasSameBacklinkIndexedLink(current, next)).toBe(true);
	});

	it("treats branch cards with the same hop1 as equal even when hop2 changes", () => {
		const sourceFile = createMockTFile("source.md");
		const current = createBranch(
			{
				hop2: [createLink({ sourceFile: createMockTFile("child-a.md") })],
			},
			{ sourceFile },
		);
		const next = createBranch(
			{
				hop2: [createLink({ sourceFile: createMockTFile("child-b.md") })],
			},
			{ sourceFile: current.hop1.sourceFile },
		);

		expect(hasSameTwoHopBranchCard(current, next)).toBe(true);
	});

	it("treats branch cards with moved hop1 positions as equal", () => {
		const sourceFile = createMockTFile("source.md");
		const current = createBranch(
			{},
			{
				sourceFile,
				position: {
					start: { line: 0, col: 0, offset: 10 },
					end: { line: 0, col: 9, offset: 19 },
				},
			},
		);
		const next = createBranch(
			{},
			{
				sourceFile,
				position: {
					start: { line: 2, col: 0, offset: 40 },
					end: { line: 2, col: 9, offset: 49 },
				},
			},
		);

		expect(hasSameTwoHopBranchCard(current, next)).toBe(true);
	});

	it("treats branch cards with a changed hop1 as different", () => {
		const current = createBranch();
		const next = createBranch({}, { displayText: "different" });

		expect(hasSameTwoHopBranchCard(current, next)).toBe(false);
	});

	it("treats omitted branch card fields like their serialized defaults", () => {
		const current = createBranch(
			{},
			{
				key: undefined,
				isUnresolved: undefined,
			},
		);
		const next = createBranch(
			{},
			{
				key: "",
				isUnresolved: false,
			},
		);

		expect(hasSameTwoHopBranchCard(current, next)).toBe(true);
	});

	it("treats tagged notes with identical identity fields as equal", () => {
		const file = createMockTFile("notes/tagged.md");
		const current = createTaggedNote({ file });
		const next = createTaggedNote({ file });

		expect(hasSameTaggedNote(current, next)).toBe(true);
	});

	it("treats tagged notes with changed usage, position, or common tags as different", () => {
		const current = createTaggedNote();

		expect(
			hasSameTaggedNote(current, createTaggedNote({ usageKey: "tag:beta" })),
		).toBe(false);
		expect(
			hasSameTaggedNote(
				current,
				createTaggedNote({
					position: {
						start: { line: 1, col: 2, offset: 11 },
						end: { line: 1, col: 8, offset: 16 },
					},
				}),
			),
		).toBe(false);
		expect(
			hasSameTaggedNote(
				current,
				createTaggedNote({ commonTags: ["beta", "alpha"] }),
			),
		).toBe(false);
	});

	it("compares tagged note arrays by length, order, and item identity", () => {
		const first = createTaggedNote({
			file: createMockTFile("notes/first.md"),
			path: "notes/first.md",
		});
		const second = createTaggedNote({
			file: createMockTFile("notes/second.md"),
			path: "notes/second.md",
		});

		expect(hasSameTaggedNotes([first, second], [first, second])).toBe(true);
		expect(hasSameTaggedNotes([first, second], [second, first])).toBe(false);
		expect(hasSameTaggedNotes([first, second], [first])).toBe(false);
		expect(
			hasSameTaggedNotes(
				[first],
				[first, createTaggedNote({ usageKey: "different" })],
			),
		).toBe(false);
	});

	it("compares taggedNote ViewItem sources using tagged note identity", () => {
		const current = {
			type: "taggedNote",
			data: createTaggedNote(),
		} as ViewItem;
		const next = {
			type: "taggedNote",
			data: createTaggedNote(),
		} as ViewItem;
		const different = {
			type: "taggedNote",
			data: createTaggedNote({ commonTags: ["gamma"] }),
		} as ViewItem;

		expect(hasSameViewItemSource(current, next)).toBe(true);
		expect(hasSameViewItemSource(current, different)).toBe(false);
	});

	it("compares file ViewItem sources using file metadata", () => {
		const currentFile = createMockTFile("notes/file.md");
		const nextFile = createMockTFile("notes/file.md");
		nextFile.stat = { ...currentFile.stat };
		const changedFile = createMockTFile("notes/file.md");
		changedFile.stat = {
			...currentFile.stat,
			mtime: currentFile.stat.mtime + 1,
		};

		expect(
			hasSameViewItemSource(
				{ type: "file", data: currentFile } as ViewItem,
				{ type: "file", data: nextFile } as ViewItem,
			),
		).toBe(true);
		expect(
			hasSameViewItemSource(
				{ type: "file", data: currentFile } as ViewItem,
				{ type: "file", data: changedFile } as ViewItem,
			),
		).toBe(false);
	});

	it("treats ViewItem sources with different types as different", () => {
		expect(
			hasSameViewItemSource(
				{
					type: "taggedNote",
					data: createTaggedNote(),
				} as ViewItem,
				{
					type: "file",
					data: createMockTFile("notes/tagged.md"),
				} as ViewItem,
			),
		).toBe(false);
	});
});
