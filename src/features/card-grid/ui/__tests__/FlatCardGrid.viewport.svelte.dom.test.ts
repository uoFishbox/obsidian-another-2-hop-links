import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/svelte";
import {
	createItems,
	renderFlatCardGrid,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestDriver";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid viewport", () => {
	it("mounts only a bounded slice around the initial viewport", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({ rootHeight: 120, width: 330 });

		driver.expectRenderedIndexes({
			include: [0],
			exclude: [15],
			minCount: 1,
			maxCount: 12,
		});
	});

	it("updates the mounted slice after scrolling while keeping mount count bounded", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
			scrollTop: 0,
		});

		driver.expectRenderedIndexes({
			include: [0],
			exclude: [15],
			maxCount: 12,
		});

		await driver.scrollTo({
			scrollTop: 402,
			sectionTop: -402,
		});

		driver.expectRenderedIndexes({
			include: [6],
			exclude: [19],
			maxCount: 12,
		});

		await driver.scrollTo({
			scrollTop: 0,
			sectionTop: 0,
		});

		driver.expectRenderedIndexes({
			include: [0],
			exclude: [15],
			maxCount: 12,
		});
	});

	it("uses fallback rows during unstable measurement and recomputes when height stabilizes", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 0,
			width: 330,
			scrollTop: 402,
		});

		driver.expectRenderedIndexes({
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
			driver.expectRenderedIndexes({
				include: [6],
				exclude: [19],
				maxCount: 12,
			});
		});
	});

	it("renders small datasets with a header during unstable initial measurements", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(2),
			showHeader: true,
			initialVisibleCount: 2,
		});

		await driver.setViewport({
			rootHeight: 0,
			width: 330,
		});

		expect(driver.getHeader()).not.toBeNull();
		expect(driver.renderedIndexes()).toEqual([0, 1]);
	});

	it("recomputes the mounted slice when the grid width changes", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		const before = driver.renderedIndexes();

		await driver.resizeTo({
			rootHeight: 120,
			width: 210,
		});

		const after = driver.renderedIndexes();

		expect(after).toContain(0);
		expect(after).not.toContain(10);
		expect(after.length).toBeLessThan(before.length);
	});
});
