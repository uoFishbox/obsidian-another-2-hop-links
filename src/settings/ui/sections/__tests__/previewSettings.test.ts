import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "settings/model";
import { PREVIEW_SETTING_DEFINITIONS } from "../previewSettings";

describe("PREVIEW_SETTING_DEFINITIONS", () => {
	it("accepts zero as the card gap", () => {
		const definition = PREVIEW_SETTING_DEFINITIONS.find(
			(candidate) => candidate.settingKey === "cardGapPx",
		);

		expect(definition?.controlType).toBe("text");
		if (!definition || definition.controlType !== "text") return;

		expect(definition.parse("0", DEFAULT_SETTINGS)).toBe(0);
		expect(definition.parse("-1", DEFAULT_SETTINGS)).toBeUndefined();
	});
});
