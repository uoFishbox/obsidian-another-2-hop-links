import { describe, expect, it } from "vitest";
import { INTERACTION_SETTING_DEFINITIONS } from "../interactionSettings";

describe("INTERACTION_SETTING_DEFINITIONS", () => {
	it("uses a toggle for highlight on open", () => {
		const definition = INTERACTION_SETTING_DEFINITIONS.find(
			(candidate) => candidate.settingKey === "highlightOnOpen",
		);

		expect(definition?.controlType).toBe("toggle");
	});

	it("uses a multiline editor that preserves custom Shadow DOM CSS", () => {
		const definition = INTERACTION_SETTING_DEFINITIONS.find(
			(candidate) => candidate.settingKey === "experimentalShadowDomCss",
		);

		expect(definition?.controlType).toBe("textarea");
		if (definition?.controlType !== "textarea") return;
		expect(definition.parse("  .card {}\n", {} as never)).toBe("  .card {}\n");
	});
});
