import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import UseVirtualListPublicationHarness from "./UseVirtualListPublicationHarness.svelte";

describe("useVirtualList reactive publication", () => {
	it("publishes surface changes but not preview-only range changes", async () => {
		const onSurfacePublication = vi.fn();
		const { getByTestId } = render(UseVirtualListPublicationHarness, {
			onSurfacePublication,
		});
		await tick();
		expect(onSurfacePublication).toHaveBeenCalledTimes(1);

		await fireEvent.click(getByTestId("initial"));
		await tick();
		expect(onSurfacePublication).toHaveBeenCalledTimes(2);

		await fireEvent.click(getByTestId("preview-only"));
		await tick();
		expect(onSurfacePublication).toHaveBeenCalledTimes(2);
	});
});
