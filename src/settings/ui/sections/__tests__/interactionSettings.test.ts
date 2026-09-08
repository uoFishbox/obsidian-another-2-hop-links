import { describe, expect, it } from "vitest";
import { INTERACTION_SETTING_DEFINITIONS } from "../interactionSettings";

describe("INTERACTION_SETTING_DEFINITIONS", () => {
	it("uses a toggle for highlight on open", () => {
		const definition = INTERACTION_SETTING_DEFINITIONS.find(
			(candidate) => candidate.settingKey === "highlightOnOpen",
		);

		expect(definition?.controlType).toBe("toggle");
	});
});
