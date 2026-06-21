import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import VirtualListCellMountHarness from "./VirtualListCellMountHarness.svelte";
import { logicalCellKey } from "../../types";

describe("VirtualListCellMount", () => {
	afterEach(() => {
		cleanup();
	});

	it("updates logical key data attributes when a reused render slot changes key", async () => {
		const { rerender, getByTestId } = render(VirtualListCellMountHarness, {
			props: {
				logicalKey: logicalCellKey("logical-a"),
			},
		});
		const cell = getByTestId("cell-mount-harness");

		expect(cell.dataset.cclLogicalKey).toBe("logical-a");

		await rerender({
			logicalKey: logicalCellKey("logical-b"),
		});

		expect(cell.dataset.cclLogicalKey).toBe("logical-b");
	});
});
