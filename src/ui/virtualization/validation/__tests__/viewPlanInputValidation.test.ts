import { describe, expect, it } from "vitest";
import { createSections } from "ui/virtualization/__tests__/ViewPlanVirtualList.test.helpers";
import { validateViewPlanInput } from "../viewPlanInputValidation";
import { formatVirtualListInputError } from "../virtualListValidationError";

describe("validateViewPlanInput", () => {
	it("returns sections and a section lookup for valid input", () => {
		const sections = createSections(2, 1);

		const result = validateViewPlanInput({ sections });

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.value.sections).toBe(sections);
		expect(result.value.sectionsBySectionId.get("section-0")).toBe(sections[0]);
		expect(result.value.sectionsBySectionId.get("section-1")).toBe(sections[1]);
	});

	it("returns a structured error for duplicate section ids", () => {
		const sections = createSections(2, 1);
		sections[1] = {
			...sections[1],
			sectionId: sections[0].sectionId,
		};

		const result = validateViewPlanInput({ sections });

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error).toMatchObject({
			type: "duplicate-section-id",
			sectionId: "section-0",
			firstIndex: 0,
			secondIndex: 1,
			firstSection: sections[0],
			secondSection: sections[1],
		});
		expect(formatVirtualListInputError(result.error)).toBe(
			'ViewPlan: duplicate sectionId "section-0". first index=0, first sectionKey="section-0"; second index=1, second sectionKey="section-1".',
		);
	});
});
