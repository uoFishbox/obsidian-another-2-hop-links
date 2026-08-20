import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import { ApplicationUiState } from "../ApplicationUiState.svelte";

describe("ApplicationUiState", () => {
	const createSettings = (overrides: Partial<typeof DEFAULT_SETTINGS> = {}) => ({
		...DEFAULT_SETTINGS,
		...overrides,
	});

	it("owns view, pagination, and preview state independently of two-hop data", () => {
		const onSortChange = vi.fn();
		const state = new ApplicationUiState(
			createSettings({ defaultVisibleLinkCount: 12 }),
			onSortChange,
		);

		state.setSortOption("modified-date");
		state.setSectionExpandedLimit("section", 24);
		state.invalidatePreviews(new Set(["note.md"]));

		expect(onSortChange).toHaveBeenCalledWith("modified-date");
		expect(state.getSectionExpandedLimit("section")).toBe(24);
		expect(state.getPreviewRenderVersion("note.md")).toBe("0:1");
		expect(state.initialVisibleCount).toBe(12);
	});

	it("increments the application update version only for display settings", () => {
		const state = new ApplicationUiState(createSettings(), vi.fn());
		const initialVersion = state.updateVersion;

		state.setSettings(
			createSettings({ cardWidthPx: state.settings.cardWidthPx + 1 }),
		);
		expect(state.updateVersion).toBe(initialVersion);

		state.setSettings(
			createSettings({ showTagsSection: !state.settings.showTagsSection }),
		);
		expect(state.updateVersion).toBe(initialVersion + 1);
	});
});
