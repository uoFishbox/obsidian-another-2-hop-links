import { describe, expect, it } from "vitest";
import { getMainUiTranslations } from "../mainUiTranslations";

describe("main UI translations", () => {
	it("returns English UI text", () => {
		const text = getMainUiTranslations("en");

		expect(text.allNotes).toBe("All notes");
		expect(text.openLink("Example")).toBe('Open "Example"');
		expect(text.noteCount(3)).toBe("3 notes");
	});

	it("returns Japanese UI text", () => {
		const text = getMainUiTranslations("ja");

		expect(text.allNotes).toBe("すべてのノート");
		expect(text.openLink("例")).toBe("「例」を開く");
		expect(text.noteCount(3)).toBe("3件のノート");
	});
});
