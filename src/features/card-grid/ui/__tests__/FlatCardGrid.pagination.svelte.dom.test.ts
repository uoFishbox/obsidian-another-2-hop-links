import { waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { renderFlatCardGridBehavior } from "./flatCardGridBehaviorDriver";
import {
	createItems,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestEnvironment";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid pagination", () => {
	it("loads the next page when the load more button is clicked", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(20),
			showHeader: true,
			initialVisibleCount: 5,
			loadMoreIncrement: 5,
		});

		await driver.setViewport({
			rootHeight: 270,
			width: 330,
		});

		await driver.clickLoadMore();

		await waitFor(() => {
			expect(driver.visibleItems()).toEqual(
				expect.arrayContaining(createItems(10)),
			);
		});

		expect(driver.hasLoadMoreButton()).toBe(true);
	});

	it("loads one additional page when the infinite-scroll sentinel intersects", async () => {
		const driver = renderFlatCardGridBehavior({
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

		expect(driver.visibleItems()).toEqual(createItems(5));
		expect(driver.hasInfiniteScrollTrigger()).toBe(true);

		driver.triggerInfiniteScroll();

		await waitFor(() => {
			expect(driver.visibleItems()).toEqual(createItems(10));
		});
	});

	it("does not chain sentinel intersections through all remaining pages", async () => {
		const driver = renderFlatCardGridBehavior({
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

		driver.triggerInfiniteScroll();

		await waitFor(() => {
			expect(driver.visibleItems()).toHaveLength(10);
		});

		expect(driver.visibleItems()).not.toContain("Item 10");
		expect(driver.visibleItems()).not.toContain("Item 15");
	});
});
