import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
import PreviewVisibilityProviderHarness from "./PreviewVisibilityProviderHarness.svelte";

describe("PreviewVisibilityProvider", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps context identity stable while reading the latest visibilityState prop", async () => {
		const onContextRead = vi.fn();
		const firstState: VirtualizedItemVisibilityState = { visibility: "mounted" };
		const secondState: VirtualizedItemVisibilityState = { visibility: "visible" };
		const { getByTestId, rerender } = render(PreviewVisibilityProviderHarness, {
			props: {
				visibilityState: firstState,
				onContextRead,
			},
		});

		expect(getByTestId("preview-visibility").textContent).toBe("mounted");
		expect(onContextRead).toHaveBeenCalledTimes(1);

		await rerender({
			visibilityState: secondState,
			onContextRead,
		});

		expect(getByTestId("preview-visibility").textContent).toBe("visible");
		expect(onContextRead).toHaveBeenCalledTimes(1);
	});
});
