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
