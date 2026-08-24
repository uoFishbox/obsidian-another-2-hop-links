import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
