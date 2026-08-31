import { describe, expect, test } from "vitest";
import {
	normalizeHrefToLookupPath,
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "../link-resolution/linkResolution";

describe("link path normalization", () => {
	test("normalizes anchors, extensions, separators, and case", () => {
		expect(normalizeLinkToMarkdownPath("folder\\Note#Heading")).toBe(
			"folder/Note.md",
		);
		expect(normalizeHrefToLookupPath("folder/Note#Heading")).toBe("folder/Note.md");
		expect(toCaseInsensitiveLookupKey("Folder/Note.md")).toBe("folder/note.md");
	});
});
