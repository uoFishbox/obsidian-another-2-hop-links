import { beforeEach, describe, expect, test, vi } from "vitest";
import { normalizePath } from "obsidian";
import {
	createFileUsageKey,
	createFileUsageKeyFromNormalizedPath,
} from "../fileIdentity";

vi.mock("obsidian", () => ({
	normalizePath: vi.fn((path: string) => path.replace(/\\/g, "/")),
}));

describe("fileIdentity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("normalizes arbitrary paths before creating a usage key", () => {
		expect(createFileUsageKey("Folder\\Note.MD")).toBe("f:folder/note.md");
		expect(normalizePath).toHaveBeenCalledOnce();
	});

	test("creates a usage key from an Obsidian-normalized path without normalizing again", () => {
		expect(createFileUsageKeyFromNormalizedPath("Folder/Note.MD")).toBe(
			"f:folder/note.md",
		);
		expect(normalizePath).not.toHaveBeenCalled();
	});
});
