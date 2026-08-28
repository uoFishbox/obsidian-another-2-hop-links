import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import UseSearchQueryHarness from "./UseSearchQueryHarness.svelte";

describe("useSearchQuery", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses the initial value for immediate and normalized search", () => {
		const view = render(UseSearchQueryHarness, {
			initialValue: " Restored Query ",
		});

		expect(view.getByLabelText("search")).toHaveValue(" Restored Query ");
		expect(view.getByTestId("normalized").textContent).toBe("restored query");
	});

	it("notifies immediately and updates the debounced query after the delay", async () => {
		vi.useFakeTimers();
		const onInputChange = vi.fn();
		const view = render(UseSearchQueryHarness, {
			onInputChange,
			delayMs: 50,
		});

		await fireEvent.input(view.getByLabelText("search"), {
			target: { value: "Next Query" },
		});
		expect(onInputChange).toHaveBeenCalledWith("Next Query");
		expect(view.getByTestId("normalized").textContent).toBe("");

		vi.advanceTimersByTime(50);
		await tick();
		expect(view.getByTestId("normalized").textContent).toBe("next query");
	});
});
