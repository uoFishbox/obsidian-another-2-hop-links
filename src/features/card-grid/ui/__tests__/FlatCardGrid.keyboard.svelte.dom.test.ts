import { fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import {
	createItems,
	renderFlatCardGrid,
	setupFlatCardGridTestEnvironment,
} from "./flatCardGridTestDriver";

setupFlatCardGridTestEnvironment();

describe("FlatCardGrid keyboard navigation", () => {
	it("moves focus between mounted cells with arrow keys", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 4000,
			width: 330,
		});

		const first = driver.getFocusTarget(0);
		first.focus();

		await fireEvent.keyDown(first, { key: "ArrowRight" });
		driver.expectFocused(1);

		await fireEvent.keyDown(driver.getFocusTarget(1), { key: "ArrowLeft" });
		driver.expectFocused(0);

		await fireEvent.keyDown(driver.getFocusTarget(0), { key: "ArrowDown" });
		driver.expectFocused(3);

		await fireEvent.keyDown(driver.getFocusTarget(3), { key: "ArrowUp" });
		driver.expectFocused(0);
	});

	it("scrolls to and focuses an offscreen navigation target", async () => {
		const driver = renderFlatCardGrid({
			items: createItems(20),
			initialVisibleCount: 20,
		});

		await driver.setViewport({
			rootHeight: 120,
			width: 330,
		});

		driver.getFocusTarget(3).focus();

		await fireEvent.keyDown(driver.getFocusTarget(3), { key: "ArrowDown" });

		await waitFor(() => {
			driver.expectFocused(6);
		});
	});
});
