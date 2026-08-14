import { describe, expect, it, vi } from "vitest";
import {
	findClosestRegisteredVirtualCell,
	findRegisteredVirtualCellElementByKey,
} from "../VirtualCellRegistry";
import { createVirtualGridSurfaceTransaction } from "../VirtualGridSurfaceTransaction";

describe("VirtualGridSurfaceTransaction", () => {
	it("updates the shared registration after announcing a logical rebind", () => {
		const container = document.createElement("div");
		const element = document.createElement("div");
		container.append(element);
		const calls: string[] = [];
		const transaction = createVirtualGridSurfaceTransaction({
			onLogicalCellWillRebind: (
				_reboundElement,
				previousLogicalKey,
				{ nextLogicalKey },
			) => {
				calls.push(`will:${previousLogicalKey}->${nextLogicalKey}`);
				expect(
					findRegisteredVirtualCellElementByKey(
						container,
						previousLogicalKey,
					),
				).toBe(element);
			},
		});

		transaction.rebindCell(element, {
			nextLogicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
		});
		transaction.rebindCell(element, {
			previousLogicalKey: "A",
			nextLogicalKey: "B",
			rowIndex: 3,
			columnIndex: 4,
		});

		expect(calls).toEqual(["will:A->B"]);
		expect(findRegisteredVirtualCellElementByKey(container, "A")).toBeNull();
		expect(findRegisteredVirtualCellElementByKey(container, "B")).toBe(element);
		expect(findClosestRegisteredVirtualCell(element)?.metadata).toEqual({
			logicalKey: "B",
			rowIndex: 3,
			columnIndex: 4,
		});

		transaction.releaseCell(element);
		expect(findRegisteredVirtualCellElementByKey(container, "B")).toBeNull();
	});

	it("does not announce an unchanged binding", () => {
		const element = document.createElement("div");
		const onLogicalCellWillRebind = vi.fn();
		const transaction = createVirtualGridSurfaceTransaction({
			onLogicalCellWillRebind,
		});
		const rebind = {
			nextLogicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
		};

		transaction.rebindCell(element, rebind);
		transaction.rebindCell(element, rebind);

		expect(onLogicalCellWillRebind).not.toHaveBeenCalled();
		expect(findClosestRegisteredVirtualCell(element)?.metadata).toEqual({
			logicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
		});
	});
});
