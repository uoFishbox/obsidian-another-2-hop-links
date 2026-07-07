import { waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import {
	createItems,
	renderVirtualGridList,
	renderVirtualGridListObject,
	setupVirtualGridTestEnvironment,
} from "./virtualGridListTestDriver";

setupVirtualGridTestEnvironment();

describe("VirtualGridLinkList regression", () => {
	it("lays out virtual rows by positioning physical row slots", async () => {
		const driver = renderVirtualGridList({
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
			expect(
				shadowRoot?.querySelectorAll(".cosense-card-links__virtual-grid-row")
					.length,
			).toBe(2);
		});

		const shadowRoot = driver.getShadowRoot();
		if (!shadowRoot) {
			throw new Error("Expected grid shadow root");
		}

		const content = shadowRoot.querySelector<HTMLElement>(
			".cosense-card-links__virtual-grid-content",
		);
		expect(content?.style.getPropertyValue("--ccl-cell-width")).toBe(
			"103.33333333333333px",
		);
		expect(content?.style.getPropertyValue("--ccl-box-height")).toBe("124px");

		const rows = Array.from(
			shadowRoot.querySelectorAll<HTMLElement>(
				".cosense-card-links__virtual-grid-row",
			),
		);
		const topSpacer = shadowRoot.querySelector<HTMLElement>(
			"[data-ccl-virtual-flow-spacer='top']",
		);
		const bottomSpacer = shadowRoot.querySelector<HTMLElement>(
			"[data-ccl-virtual-flow-spacer='bottom']",
		);
		expect(topSpacer?.style.height).toBe("0px");
		expect(bottomSpacer).not.toBeNull();
		expect(bottomSpacer?.style.height).toBe("0px");
		expect(rows[0].style.position).toBe("absolute");
		expect(rows[0].style.top).toBe("0px");
		expect(rows[0].style.transform).toBe("");
		expect(rows[1].style.position).toBe("absolute");
		expect(rows[1].style.top).toBe("134px");
		expect(rows[1].style.transform).toBe("");

		const cells = Array.from(
			shadowRoot.querySelectorAll<HTMLElement>(
				".cosense-card-links__virtual-grid-cell",
			),
		);
		expect(cells).toHaveLength(6);
		for (const cell of cells) {
			expect(cell.style.transform).toBe("");
			expect(cell.style.width).toBe("");
			expect(cell.style.height).toBe("");
		}
	});

	it("reuses physical row shells when a logical row leaves the mounted range", async () => {
		const driver = renderVirtualGridList({
			items: createItems(30),
			initialVisibleCount: 30,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		await waitFor(() => {
			expect(driver.renderedIndexes()).toContain(0);
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

		const rows = Array.from(
			shadowRoot.querySelectorAll<HTMLElement>(
				".cosense-card-links__virtual-grid-row",
			),
		);
		const rowSlots = rows.map((row) => Number(row.dataset.cclRowSlot));
		expect(rowSlots).toEqual([...rowSlots].sort((left, right) => left - right));
		for (const row of rows) {
			expect(row.style.position).toBe("absolute");
			expect(row.style.top).toMatch(/px$/);
			expect(row.style.transform).toBe("");
		}
		expect(driver.renderedIndexes()).not.toContain(0);
	});

	it("does not shift the mounted slice for upstream spacer changes alone", async () => {
		const driver = renderVirtualGridList({
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

		driver.expectRenderedIndexes({
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

		driver.expectRenderedIndexes({
			include: [15],
			exclude: [0],
			maxCount: 12,
		});

		await driver.resizeGrid({ width: 330, height: 2001 });

		await waitFor(() => {
			expect(driver.renderedIndexes()).toEqual([]);
		});
	});

	it("updates rendered content when an item object changes without changing its key", async () => {
		const initialItems = Array.from({ length: 4 }, (_, index) => ({
			id: `item-${index}`,
			label: `Initial ${index}`,
		}));

		const driver = renderVirtualGridListObject({
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

		const driver = renderVirtualGridListObject({
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

	it("updates rendered content when the same item object reports a new item render revision", async () => {
		const items = Array.from({ length: 2 }, (_, index) => ({
			id: `item-${index}`,
			label: `Initial ${index}`,
			renderVersion: 0,
		}));

		const driver = renderVirtualGridListObject({
			items,
			itemsRevision: 0,
			initialVisibleCount: 2,
			useItemRenderRevision: true,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		await waitFor(() => {
			expect(driver.queryByText("Initial 0")).not.toBeNull();
		});

		items[0].label = "Updated 0";
		items[0].renderVersion += 1;

		await driver.rerender({
			items,
			itemsRevision: 1,
			useItemRenderRevision: true,
		});

		await waitFor(() => {
			expect(driver.queryByText("Updated 0")).not.toBeNull();
		});
		expect(driver.queryByText("Initial 0")).toBeNull();
	});
});
