import { fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import {
	createItems,
	renderFlatCardGrid,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestDriver";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid pagination", () => {
	it("loads the next page when the load more button is clicked", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			showHeader: true,
			initialVisibleCount: 5,
			loadMoreIncrement: 5,
		});

		await driver.setViewport({
			rootHeight: 270,
			width: 330,
		});

		await fireEvent.click(driver.getLoadMoreButton());

		await waitFor(() => {
			expect(driver.renderedIndexes()).toEqual(
				expect.arrayContaining([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
			);
		});

		expect(driver.getLoadMoreButton()).not.toBeNull();
	});

	it("loads one additional page when the infinite-scroll sentinel intersects", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 5,
			loadMoreIncrement: 5,
			paginationMode: "infinite-scroll",
			infiniteScrollRootMargin: "0px",
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		expect(driver.renderedIndexes()).toEqual([0, 1, 2, 3, 4]);

		const sentinel = driver.getSentinel();
		expect(sentinel).not.toBeNull();

		driver.intersectSentinel();

		await waitFor(() => {
			expect(driver.renderedIndexes()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});
	});

	it("keeps the infinite-scroll sentinel outside the shadow root", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 5,
			loadMoreIncrement: 5,
			paginationMode: "infinite-scroll",
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		expect(driver.getSentinel()).not.toBeNull();
		expect(
			driver
				.getShadowRoot()
				?.querySelector(".cosense-card-links__infinite-scroll-sentinel"),
		).toBeNull();
	});

	it("does not chain sentinel intersections through all remaining pages", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 5,
			loadMoreIncrement: 5,
			paginationMode: "infinite-scroll",
			infiniteScrollRootMargin: "0px",
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		driver.intersectSentinel();

		await waitFor(() => {
			expect(driver.renderedIndexes()).toHaveLength(10);
		});

		expect(driver.renderedIndexes()).not.toContain(10);
		expect(driver.renderedIndexes()).not.toContain(15);
	});
});
