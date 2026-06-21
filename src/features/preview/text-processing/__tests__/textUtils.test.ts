import { describe, test, expect } from "vitest";
import {
	formatLinkText,
	generateLinkKey,
	qualifyDuplicateKey,
} from "../textUtils";

describe("formatLinkText", () => {
	test.each([
		{ desc: "unresolved with alias", rawText: "note|alias", isUnresolved: true, expected: "note" },
		{ desc: "unresolved without alias", rawText: "note", isUnresolved: true, expected: "note" },
		{ desc: "resolved with displayText", rawText: "raw", displayText: "  Display  ", expected: "Display" },
		{ desc: "resolved without displayText", rawText: "raw text", expected: "raw text" },
		{ desc: "resolved with empty displayText", rawText: "raw", displayText: "", expected: "raw" },
		{ desc: "unresolved with hash", rawText: "note#section", isUnresolved: true, expected: "note" },
		{ desc: "unresolved with hash before alias", rawText: "note#section|alias", isUnresolved: true, expected: "note" },
	])("returns $expected for $desc", ({ rawText, displayText, isUnresolved, expected }) => {
		expect(formatLinkText({ rawText, displayText, isUnresolved })).toBe(expected);
	});
});

describe("generateLinkKey", () => {
	test("generates length-prefixed key from path and linkText", () => {
		expect(generateLinkKey("path/to/file.md", "link text")).toBe(
			"15:path/to/file.md|9:link text|0:",
		);
	});

	test("appends non-empty suffix", () => {
		expect(generateLinkKey("path/to/file.md", "link text", "suffix")).toBe(
			"15:path/to/file.md|9:link text|6:suffix",
		);
	});

	test("omits empty suffix", () => {
		expect(generateLinkKey("path/to/file.md", "link text", "")).toBe(
			"15:path/to/file.md|9:link text|0:",
		);
	});

	test("handles spaces and special chars without collision", () => {
		const keyA = generateLinkKey("a-b", "c", "");
		const keyB = generateLinkKey("a", "b-c", "");
		expect(keyA).not.toBe(keyB);
	});
});

describe("qualifyDuplicateKey", () => {
	test("returns base key for occurrence 0", () => {
		expect(qualifyDuplicateKey("base", 0)).toBe("base");
	});

	test("appends ::dup:N for positive occurrence", () => {
		expect(qualifyDuplicateKey("base", 1)).toBe("base::dup:1");
		expect(qualifyDuplicateKey("base", 3)).toBe("base::dup:3");
	});
});
