import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import LoadingState from "../LoadingState.svelte";

describe("LoadingState", () => {
	afterEach(cleanup);

	it("renders an accessible busy status with an optional message", () => {
		const view = render(LoadingState, {
			props: { message: "Loading cards..." },
		});
		const status = view.getByRole("status");

		expect(status).toHaveAttribute("aria-live", "polite");
		expect(status).toHaveAttribute("aria-busy", "true");
		expect(status).toHaveTextContent("Loading cards...");
	});
});
