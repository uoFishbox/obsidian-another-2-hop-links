import { describe, expect, it } from "vitest";
import {
	createItems,
	renderVirtualGridList,
	setupVirtualGridTestEnvironment,
} from "./virtualGridListTestDriver";

setupVirtualGridTestEnvironment();

describe("VirtualGridLinkList shadow DOM", () => {
	it("renders grid items inside the interaction shadow root", async () => {
		const driver = renderVirtualGridList({
			items: createItems(6),
			initialVisibleCount: 6,
		});

		await driver.setViewport({
			rootHeight: 1200,
			width: 330,
		});

		const shadowRoot = driver.getShadowRoot();

		expect(shadowRoot).not.toBeNull();
		expect(driver.renderedIndexesInShadowRoot()).toEqual(
			expect.arrayContaining([0, 1, 2]),
		);
	});
});
