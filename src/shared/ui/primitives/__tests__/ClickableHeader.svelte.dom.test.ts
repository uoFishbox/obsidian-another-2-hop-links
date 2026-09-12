import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import ClickableHeaderHarness from "./ClickableHeaderHarness.svelte";

describe("ClickableHeader", () => {
	afterEach(cleanup);

	it("forwards controlled activation and generic data attributes", async () => {
		const onclick = vi.fn();
		const view = render(ClickableHeaderHarness, { props: { onclick } });
		const header = view.getByRole("button", { name: "2 notes" });

		expect(header).toHaveAttribute("data-test-kind", "generic");
		expect(view.getByTestId("icon")).toHaveTextContent("icon");

		await fireEvent.click(header);
		await fireEvent.keyDown(header, { key: "Enter" });
		await fireEvent.keyDown(header, { key: " " });

		expect(onclick).toHaveBeenCalledTimes(3);
	});

	it("only makes the header draggable on desktop", () => {
		const desktopView = render(ClickableHeaderHarness, {
			props: { draggable: true },
		});
		expect(desktopView.getByRole("button")).toHaveAttribute("draggable", "true");
		desktopView.unmount();

		Platform.isMobile = true;
		const mobileView = render(ClickableHeaderHarness, {
			props: { draggable: true },
		});
		Platform.isMobile = false;

		expect(mobileView.getByRole("button")).not.toHaveAttribute("draggable");
	});
});
