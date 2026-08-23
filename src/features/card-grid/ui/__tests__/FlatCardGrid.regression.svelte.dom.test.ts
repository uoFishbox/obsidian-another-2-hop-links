import { waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import {
	renderFlatCardGridContract,
	renderFlatCardGridObjectContract,
} from "./flatCardGridContractFixture";
import {
	createItems,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestEnvironment";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid regression", () => {
	it("renders a bounded mounted grid in logical order", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 400,
			width: 330,
		});

		await waitFor(() => {
			const shadowRoot = driver.getShadowRoot();
			expect(shadowRoot).not.toBeNull();
			const rowCount = shadowRoot?.querySelectorAll(
				".cosense-card-links__virtual-grid-row",
			).length;
			expect(rowCount).toBeGreaterThan(0);
			expect(rowCount).toBeLessThan(6);
		});

		expect(driver.mountedLogicalIndexesInShadowRoot()).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("reuses physical row shells when a logical row leaves the mounted range", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(30),
			initialVisibleCount: 30,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		await waitFor(() => {
			expect(driver.mountedLogicalIndexes()).toContain(0);
		});

		const shadowRoot = driver.getShadowRoot();
		if (!shadowRoot) {
			throw new Error("Expected grid shadow root");
		}

		const firstRowShell = shadowRoot.querySelector<HTMLElement>(
			"[data-ccl-row-slot='0']",
		);
		expect(firstRowShell).not.toBeNull();
		expect(firstRowShell?.dataset.cclRowIndex).toBe("0");

		await driver.scrollTo({
			scrollTop: 804,
			sectionTop: -804,
		});

		await waitFor(() => {
			expect(firstRowShell?.isConnected).toBe(true);
			expect(firstRowShell?.dataset.cclRowIndex).not.toBe("0");
		});

		expect(driver.mountedLogicalIndexes()).not.toContain(0);
		const logicalIndexes = Array.from(
			shadowRoot.querySelectorAll<HTMLElement>("[data-testid='item-cell']"),
		).map((cell) => Number(cell.dataset.index));
		expect(logicalIndexes).toEqual(
			[...logicalIndexes].sort((left, right) => left - right),
		);
	});

	it("does not shift the mounted slice for upstream spacer changes alone", async () => {
		const driver = renderFlatCardGridContract({
			items: createItems(20),
			initialVisibleCount: 20,
			topSpacerHeight: 390,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
			scrollTop: 0,
			sectionTop: 0,
		});

		await driver.scrollTo({
			scrollTop: 804,
			sectionTop: -804,
		});

		driver.expectMountedLogicalIndexes({
			include: [15],
			exclude: [0],
			maxCount: 12,
		});

		driver.setTopSpacerHeight(780);
		driver.setGridRect({
			sectionTop: 390,
			width: 330,
			height: 2000,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		await Promise.resolve();
		await Promise.resolve();

		driver.expectMountedLogicalIndexes({
			include: [15],
			exclude: [0],
			maxCount: 12,
		});

		await driver.resizeGrid({ width: 330, height: 2001 });

		await waitFor(() => {
			expect(driver.mountedLogicalIndexes()).toEqual([]);
		});
	});

	it("updates rendered content when an item object changes without changing its key", async () => {
		const initialItems = Array.from({ length: 4 }, (_, index) => ({
			id: `item-${index}`,
			label: `Initial ${index}`,
		}));

		const driver = renderFlatCardGridObjectContract({
			items: initialItems,
			initialVisibleCount: 2,
			loadMoreIncrement: 2,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		await waitFor(() => {
			expect(driver.queryByText("Initial 0")).not.toBeNull();
		});

		const updatedItems = initialItems.map((item, index) => ({
			id: item.id,
			label: `Updated ${index}`,
		}));

		await driver.rerender({ items: updatedItems });

		await waitFor(() => {
			expect(driver.queryByText("Updated 0")).not.toBeNull();
		});
		expect(driver.queryByText("Initial 0")).toBeNull();
	});

	it("updates rendered content after in-place array element replacement when itemsRevision changes", async () => {
		const items = Array.from({ length: 3 }, (_, index) => ({
			id: `item-${index}`,
			label: `Initial ${index}`,
		}));

		const driver = renderFlatCardGridObjectContract({
			items,
			itemsRevision: 0,
			initialVisibleCount: 3,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		await waitFor(() => {
			expect(driver.queryByText("Initial 1")).not.toBeNull();
		});

		items[1] = {
			id: "item-1",
			label: "Updated 1",
		};

		await driver.rerender({
			items,
			itemsRevision: 1,
		});

		await waitFor(() => {
			expect(driver.queryByText("Updated 1")).not.toBeNull();
		});
		expect(driver.queryByText("Initial 1")).toBeNull();
	});

	it("updates rendered content when the same item object changes with itemsRevision", async () => {
		const items = Array.from({ length: 2 }, (_, index) => ({
			id: `item-${index}`,
			label: `Initial ${index}`,
		}));

		const driver = renderFlatCardGridObjectContract({
			items,
			itemsRevision: 0,
			initialVisibleCount: 2,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		await waitFor(() => {
			expect(driver.queryByText("Initial 0")).not.toBeNull();
		});

		items[0].label = "Updated 0";

		await driver.rerender({
			items,
			itemsRevision: 1,
		});

		await waitFor(() => {
			expect(driver.queryByText("Updated 0")).not.toBeNull();
		});
		expect(driver.queryByText("Initial 0")).toBeNull();
	});
});
