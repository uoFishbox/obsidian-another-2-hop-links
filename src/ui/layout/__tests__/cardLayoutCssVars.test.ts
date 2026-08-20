import { describe, expect, it } from "vitest";
import { createResolvedCardLayoutSettingsMemo } from "../cardLayoutCssVars";

describe("createResolvedCardLayoutSettingsMemo", () => {
	it("reuses the resolved layout when non-layout settings change", () => {
		const resolveLayout = createResolvedCardLayoutSettingsMemo();
		const first = resolveLayout({
			cardWidthPx: 140,
			cardHeightRatio: 1.1,
			cardGapPx: 12,
			cardMaxColumns: 6,
			sectionMarginBottomPx: 45,
		});
		const second = resolveLayout({
			cardWidthPx: 140,
			cardHeightRatio: 1.1,
			cardGapPx: 12,
			cardMaxColumns: 6,
			sectionMarginBottomPx: 45,
		});

		expect(second).toBe(first);
	});

	it("returns a new resolved layout when a layout setting changes", () => {
		const resolveLayout = createResolvedCardLayoutSettingsMemo();
		const first = resolveLayout({
			cardWidthPx: 140,
			cardHeightRatio: 1.1,
			cardGapPx: 12,
			cardMaxColumns: 6,
			sectionMarginBottomPx: 45,
		});
		const second = resolveLayout({
			cardWidthPx: 160,
			cardHeightRatio: 1.1,
			cardGapPx: 12,
			cardMaxColumns: 6,
			sectionMarginBottomPx: 45,
		});

		expect(second).not.toBe(first);
		expect(second?.cardWidthPx).toBe(160);
	});
});
