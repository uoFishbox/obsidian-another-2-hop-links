import { describe, expect, it, vi } from "vitest";
import { createVirtualCellBindingRegistry } from "../cellBindingRegistry";

describe("VirtualCellBindingRegistry", () => {
	it("updates the shared registration after announcing a logical rebind", () => {
		const container = document.createElement("div");
		const element = document.createElement("div");
		container.append(element);
		const calls: string[] = [];
		const registry = createVirtualCellBindingRegistry({
			onLogicalCellWillRebind: (
				_reboundElement,
				previousLogicalKey,
				{ nextLogicalKey },
			) => {
				calls.push(`will:${previousLogicalKey}->${nextLogicalKey}`);
				expect(
					registry.findCellElementByKey(container, previousLogicalKey),
				).toBe(element);
			},
		});

		registry.rebindCell(element, {
			nextLogicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
		});
		registry.rebindCell(element, {
			previousLogicalKey: "A",
			nextLogicalKey: "B",
			rowIndex: 3,
			columnIndex: 4,
		});

		expect(calls).toEqual(["will:A->B"]);
		expect(registry.findCellElementByKey(container, "A")).toBeNull();
		expect(registry.findCellElementByKey(container, "B")).toBe(element);
		expect(registry.findClosestCell(element)?.metadata).toEqual({
			logicalKey: "B",
			rowIndex: 3,
			columnIndex: 4,
		});

		registry.releaseCell(element);
		expect(registry.findCellElementByKey(container, "B")).toBeNull();
	});

	it("does not announce an unchanged binding", () => {
		const element = document.createElement("div");
		const onLogicalCellWillRebind = vi.fn();
		const registry = createVirtualCellBindingRegistry({
			onLogicalCellWillRebind,
		});
		const rebind = {
			nextLogicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
		};

		registry.rebindCell(element, rebind);
		registry.rebindCell(element, rebind);

		expect(onLogicalCellWillRebind).not.toHaveBeenCalled();
		expect(registry.findClosestCell(element)?.metadata).toEqual({
			logicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
		});
	});
});
