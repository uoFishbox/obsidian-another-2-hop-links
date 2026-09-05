import { fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { renderFlatCardGridBehavior } from "./flatCardGridBehaviorDriver";
import {
	createItems,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestEnvironment";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid keyboard navigation", () => {
	it("moves focus between mounted cells with arrow keys", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		const first = driver.getItem("Item 0");
		first.focus();

		await fireEvent.keyDown(first, { key: "ArrowRight" });
		driver.expectFocusedItem("Item 1");

		await fireEvent.keyDown(driver.getItem("Item 1"), { key: "ArrowLeft" });
		driver.expectFocusedItem("Item 0");

		await fireEvent.keyDown(driver.getItem("Item 0"), { key: "ArrowDown" });
		driver.expectFocusedItem("Item 3");

		await fireEvent.keyDown(driver.getItem("Item 3"), { key: "ArrowUp" });
		driver.expectFocusedItem("Item 0");
	});

	it("does not read DOM geometry when the adjacent virtual cell is mounted", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(6),
			initialVisibleCount: 6,
		});
		await driver.setViewport({ rootHeight: 4000, width: 330 });

		const first = driver.getItem("Item 0");
		const second = driver.getItem("Item 1");
		const scrollIntoView = vi.spyOn(second, "scrollIntoView");
		first.focus();
		const geometryRead = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
		geometryRead.mockClear();

		await fireEvent.keyDown(first, { key: "ArrowRight" });

		expect(geometryRead).not.toHaveBeenCalled();
		driver.expectFocusedItem("Item 1");
		expect(scrollIntoView).toHaveBeenCalledWith({
			block: "nearest",
			inline: "nearest",
		});
		geometryRead.mockRestore();
	});

	it("moves focus to the start of the next row when pressing ArrowRight at the end of a row", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		const firstRowEnd = driver.getItem("Item 2");
		firstRowEnd.focus();

		await fireEvent.keyDown(firstRowEnd, { key: "ArrowRight" });
		driver.expectFocusedItem("Item 3");
	});

	it("moves focus to the same target using ArrowRight as Tab at row ends", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		const item2 = driver.getItem("Item 2");
		item2.focus();
		await fireEvent.keyDown(item2, { key: "Tab" });
		driver.expectFocusedItem("Item 3");

		item2.focus();
		await fireEvent.keyDown(item2, { key: "ArrowRight" });
		driver.expectFocusedItem("Item 3");
	});

	it("moves focus to the end of the previous row when pressing ArrowLeft at the start of a row", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		const secondRowStart = driver.getItem("Item 3");
		secondRowStart.focus();

		await fireEvent.keyDown(secondRowStart, { key: "ArrowLeft" });
		driver.expectFocusedItem("Item 2");
	});

	it("moves focus to the same target using ArrowLeft as Shift+Tab at row starts", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		const item3 = driver.getItem("Item 3");
		item3.focus();
		await fireEvent.keyDown(item3, { key: "Tab", shiftKey: true });
		driver.expectFocusedItem("Item 2");

		item3.focus();
		await fireEvent.keyDown(item3, { key: "ArrowLeft" });
		driver.expectFocusedItem("Item 2");
	});

	it("scrolls to and focuses an offscreen navigation target", async () => {
		const driver = renderFlatCardGridBehavior({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		driver.getItem("Item 3").focus();

		await fireEvent.keyDown(driver.getItem("Item 3"), { key: "ArrowDown" });

		await waitFor(() => {
			driver.expectFocusedItem("Item 6");
		});
	});
});
