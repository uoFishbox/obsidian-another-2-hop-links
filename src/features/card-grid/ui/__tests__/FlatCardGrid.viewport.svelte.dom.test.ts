import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/svelte";
import { renderFlatCardGridContract } from "./flatCardGridContractFixture";
import {
	createItems,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestEnvironment";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid virtualization contract", () => {
	it("keeps the infinite-scroll sentinel outside the shadow root", async () => {
		const fixture = renderFlatCardGridContract({
			items: createItems(20),
			initialVisibleCount: 5,
			loadMoreIncrement: 5,
			paginationMode: "infinite-scroll",
		});

		await fixture.setViewport({ rootHeight: 120, width: 330 });

		expect(fixture.getInfiniteScrollSentinel()).not.toBeNull();
		expect(
			fixture
				.getShadowRoot()
				?.querySelector(".cosense-card-links__infinite-scroll-sentinel"),
		).toBeNull();
	});

	it("mounts only a bounded slice around the initial viewport", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({ rootHeight: 120, width: 330 });

		driver.expectMountedLogicalIndexes({
			include: [0],
			exclude: [15],
			minCount: 1,
			maxCount: 12,
		});
	});

	it("updates the mounted slice after scrolling while keeping mount count bounded", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
			scrollTop: 0,
		});

		driver.expectMountedLogicalIndexes({
			include: [0],
			exclude: [15],
			maxCount: 12,
		});

		await driver.scrollTo({
			scrollTop: 402,
			sectionTop: -402,
		});

		driver.expectMountedLogicalIndexes({
			include: [6],
			exclude: [19],
			maxCount: 12,
		});

		await driver.scrollTo({
			scrollTop: 0,
			sectionTop: 0,
		});

		driver.expectMountedLogicalIndexes({
			include: [0],
			exclude: [15],
			maxCount: 12,
		});
	});

	it("uses fallback rows during unstable measurement and recomputes when height stabilizes", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 0,
			width: 330,
			scrollTop: 402,
		});

		driver.expectMountedLogicalIndexes({
			include: [0],
			exclude: [15],
			maxCount: 12,
		});

		driver.setGridRect({
			sectionTop: -402,
			width: 330,
			height: 2000,
		});

		await driver.resizeTo({
			rootHeight: 120,
			width: 330,
		});

		await waitFor(() => {
			driver.expectMountedLogicalIndexes({
				include: [6],
				exclude: [19],
				maxCount: 12,
			});
		});
	});

	it("renders small datasets with a header during unstable initial measurements", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(2),
			showHeader: true,
			initialVisibleCount: 2,
		});

		await driver.setViewport({
			rootHeight: 0,
			width: 330,
		});

		expect(driver.getHeader()).not.toBeNull();
		expect(driver.mountedLogicalIndexes()).toEqual([0, 1]);
	});

	it("recomputes the mounted slice when the grid width changes", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		const before = driver.mountedLogicalIndexes();

		await driver.resizeTo({
			rootHeight: 120,
			width: 210,
		});

		const after = driver.mountedLogicalIndexes();

		expect(after).toContain(0);
		expect(after).not.toContain(10);
		expect(after.length).toBeLessThan(before.length);
	});
});
