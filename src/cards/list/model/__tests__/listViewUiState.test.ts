import { describe, expect, it } from "vitest";
import { createListViewUiState } from "../listViewUiState";

describe("createListViewUiState", () => {
	it("copies valid navigation state", () => {
		const source = {
			searchInputValue: "project",
			scrollState: {
				localScrollTop: 12840,
				visibleCount: 500,
			},
		};

		const result = createListViewUiState(source);

		expect(result).toEqual(source);
		expect(result).not.toBe(source);
		expect(result.scrollState).not.toBe(source.scrollState);
	});

	it("normalizes numeric bounds and rejects malformed scroll state", () => {
		expect(
			createListViewUiState({
				searchInputValue: "alpha",
				scrollState: { localScrollTop: -20, visibleCount: 7.9 },
			}),
		).toEqual({
			searchInputValue: "alpha",
			scrollState: { localScrollTop: 0, visibleCount: 7 },
		});
		expect(
			createListViewUiState({
				searchInputValue: 42,
				scrollState: { localScrollTop: Number.NaN, visibleCount: 20 },
			}),
		).toEqual({ searchInputValue: "" });
	});
});
