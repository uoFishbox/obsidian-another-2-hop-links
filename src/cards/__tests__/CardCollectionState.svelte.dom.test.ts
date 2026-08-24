import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "settings/model";
import { CardCollectionState } from "cards/CardCollectionState.svelte";

describe("CardCollectionState", () => {
	const createSettings = (overrides: Partial<typeof DEFAULT_SETTINGS> = {}) => ({
		...DEFAULT_SETTINGS,
		...overrides,
	});

	it("owns card sorting and pagination independently of two-hop data", () => {
		const onSortChange = vi.fn();
		const state = new CardCollectionState(
			createSettings({ defaultVisibleLinkCount: 12 }),
			onSortChange,
		);

		state.setSortOption("modified-date");
		state.setSectionExpandedLimit("section", 24);

		expect(onSortChange).toHaveBeenCalledWith("modified-date");
		expect(state.getSectionExpandedLimit("section")).toBe(24);
		expect(state.initialVisibleCount).toBe(12);
	});

	it("increments the application update version only for display settings", () => {
		const state = new CardCollectionState(createSettings(), vi.fn());
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
