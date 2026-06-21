import { describe, expect, test, vi, type Mock } from "vitest";
import { readRawContent } from "../rawContentReader";
import {
	createMockTFileAsPlainObject,
	createMockVault,
} from "testing/__mocks__/testHelpers";

describe("readRawContent", () => {
	test("reads raw content separately for each caller", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		const vault = createMockVault();
		(vault.cachedRead as Mock).mockResolvedValue("content");

		await expect(readRawContent(file, vault)).resolves.toBe("content");
		await expect(readRawContent(file, vault)).resolves.toBe("content");

		expect(vault.cachedRead).toHaveBeenCalledTimes(2);
	});

	test("rejects when caller aborts while reading raw content", async () => {
		const file = createMockTFileAsPlainObject("note.md");
		const vault = createMockVault();
		(vault.cachedRead as Mock).mockReturnValue(new Promise(() => {}));
		const controller = new AbortController();

		const result = readRawContent(file, vault, controller.signal);
		controller.abort();

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});
});
