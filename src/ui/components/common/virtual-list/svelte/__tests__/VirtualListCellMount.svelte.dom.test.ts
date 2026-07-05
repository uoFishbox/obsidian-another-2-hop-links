import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import VirtualListCellMountHarness from "./VirtualListCellMountHarness.svelte";
import { logicalCellKey } from "../../types";
import { getVirtualCellMetadata } from "../VirtualCellRegistry";

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

	it("updates registry metadata without replacing the mounted element", async () => {
		const { rerender, getByTestId } = render(VirtualListCellMountHarness, {
			props: {
				logicalKey: logicalCellKey("logical-a"),
			},
		});
		const cell = getByTestId("cell-mount-harness");

		await tick();
		expect(getVirtualCellMetadata(cell)?.logicalKey).toBe("logical-a");

		await rerender({
			logicalKey: logicalCellKey("logical-b"),
		});
		await tick();

		expect(getByTestId("cell-mount-harness")).toBe(cell);
		expect(getVirtualCellMetadata(cell)?.logicalKey).toBe("logical-b");
	});
});
