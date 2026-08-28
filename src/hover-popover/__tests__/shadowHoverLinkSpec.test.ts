import { describe, expect, it } from "vitest";
import type { Pos } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { buildShadowHoverLinkSpec } from "../shadowHoverLinkSpec";
import type { AppContext } from "cards/context/linkContext";
import type {
	SectionHeaderInteractionDescriptor,
	ItemInteractionDescriptor,
} from "cards/interactions/interactionTypes";

function createPosition(line: number): Pos {
	return {
		start: { line, col: 0, offset: line * 10 },
		end: { line, col: 5, offset: line * 10 + 5 },
	};
}

describe("buildShadowHoverLinkSpec", () => {
	it("builds a highlighted spec for tagged-note items", () => {
		const sourceFile = createMockTFile("source.md");
		const targetFile = createMockTFile("target.md");
		const descriptor: ItemInteractionDescriptor = {
			interactionId: "item:taggedNote:target.md",
			kind: "item",
			item: {
				type: "taggedNote",
				data: {
					file: sourceFile,
					commonTags: [],
					path: targetFile.path,
					position: createPosition(7),
				},
			},
			targetFile,
			settings: {
				highlightInPreviewOnHover: true,
			} as any,
		};

		const spec = buildShadowHoverLinkSpec(descriptor, undefined);

		expect(spec).toEqual({
			linktext: targetFile.path,
			sourcePath: sourceFile.path,
			state: {
				line: 7,
				scroll: 7,
			},
		});
	});

	it("uses the preferred search-match position for branch items", () => {
		const sourceFile = createMockTFile("source.md");
		const targetFile = createMockTFile("target.md");
		const preferredPosition = createPosition(12);
		const descriptor: ItemInteractionDescriptor = {
			interactionId: "item:branch:target",
			kind: "item",
			item: {
				type: "branch",
				data: {
					hop1: {
						rawText: "target#Heading",
						path: targetFile.path,
						sourceFile,
						isUnresolved: false,
						position: createPosition(3),
					},
					hop2: [],
				},
			},
			targetFile,
			settings: {
				highlightInPreviewOnHover: false,
			} as any,
			searchQuery: "target",
		};
		const appContext = {
			resolveSearchMatchPosition: () => preferredPosition,
		} as unknown as AppContext;

		const spec = buildShadowHoverLinkSpec(descriptor, appContext);

		expect(spec).toEqual({
			linktext: targetFile.path,
			sourcePath: sourceFile.path,
			state: {
				line: 12,
				scroll: 12,
			},
		});
	});

	it("returns null for unresolved new-link items", () => {
		const targetFile = createMockTFile("target.md");
		const descriptor: ItemInteractionDescriptor = {
			interactionId: "item:newLink:missing",
			kind: "item",
			item: {
				type: "newLink",
				data: {
					rawText: "Missing",
					path: "Missing",
					sourceFile: targetFile,
					isUnresolved: true,
				},
			},
			targetFile: null,
		};

		expect(buildShadowHoverLinkSpec(descriptor, undefined)).toBeNull();
	});

	it("preserves outgoing section-header link text behavior", () => {
		const sourceFile = createMockTFile("source.md");
		const targetFile = createMockTFile("target.md");
		const descriptor: SectionHeaderInteractionDescriptor = {
			interactionId: "section:target",
			kind: "sectionHeader",
			link: {
				rawText: "target#Section",
				path: targetFile.path,
				sourceFile,
				isUnresolved: false,
			},
			isOutgoingLink: true,
			targetFile,
			settings: {
				highlightInPreviewOnHover: false,
			} as any,
		};

		const spec = buildShadowHoverLinkSpec(descriptor, undefined);

		expect(spec).toEqual({
			linktext: `${targetFile.path}#Section`,
			sourcePath: sourceFile.path,
			state: undefined,
		});
	});
});
