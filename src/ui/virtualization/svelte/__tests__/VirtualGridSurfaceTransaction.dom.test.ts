import { describe, expect, it, vi } from "vitest";
import { createSurfaceVirtualCellRegistry } from "../VirtualCellRegistry";
import { createVirtualGridSurfaceTransaction } from "../VirtualGridSurfaceTransaction";

describe("VirtualGridSurfaceTransaction", () => {
	it("applies rebind lifecycle and registry changes in one ordered transaction", () => {
		const element = document.createElement("div");
		const registry = createSurfaceVirtualCellRegistry();
		const calls: string[] = [];
		const transaction = createVirtualGridSurfaceTransaction({
			onLogicalCellWillRebind: (
				_reboundElement,
				previousLogicalKey,
				{ nextLogicalKey },
			) => {
				calls.push(`will:${previousLogicalKey}->${nextLogicalKey}`);
				expect(registry.findByKey(previousLogicalKey)).toBe(element);
			},
		});

		transaction.rebindCell(element, {
			nextLogicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
			cellRegistry: registry,
			lifecycleValue: "A",
			onAttach: (value) => {
				calls.push(`attach:${value}`);
				expect(registry.findByKey("A")).toBe(element);
			},
			onDetach: (value) => calls.push(`detach:${value}`),
		});
		transaction.rebindCell(element, {
			previousLogicalKey: "A",
			nextLogicalKey: "B",
			rowIndex: 3,
			columnIndex: 4,
			cellRegistry: registry,
			lifecycleValue: "B",
			onAttach: (value) => {
				calls.push(`attach:${value}`);
				expect(registry.findByKey("A")).toBeNull();
				expect(registry.findByKey("B")).toBe(element);
			},
			onDetach: (value) => calls.push(`detach:${value}`),
		});

		expect(calls).toEqual(["attach:A", "will:A->B", "detach:A", "attach:B"]);
		expect(registry.findClosest(element)?.metadata).toEqual({
			logicalKey: "B",
			rowIndex: 3,
			columnIndex: 4,
		});

		transaction.releaseCell(element);
		expect(calls).toEqual([
			"attach:A",
			"will:A->B",
			"detach:A",
			"attach:B",
			"detach:B",
		]);
		expect(registry.findByKey("B")).toBeNull();
	});

	it("does not repeat lifecycle or metadata work for an unchanged binding", () => {
		const element = document.createElement("div");
		const update = vi.fn();
		const unregister = vi.fn();
		const registry = {
			createRegistration: vi.fn(() => ({ update, unregister })),
			findByKey: vi.fn(() => null),
			findClosest: vi.fn(() => null),
		};
		const attach = vi.fn();
		const detach = vi.fn();
		const transaction = createVirtualGridSurfaceTransaction();
		const rebind = {
			nextLogicalKey: "A",
			rowIndex: 1,
			columnIndex: 2,
			cellRegistry: registry,
			lifecycleValue: "A",
			onAttach: attach,
			onDetach: detach,
		};

		transaction.rebindCell(element, rebind);
		transaction.rebindCell(element, rebind);

		expect(registry.createRegistration).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledTimes(1);
		expect(attach).toHaveBeenCalledTimes(1);
		expect(detach).not.toHaveBeenCalled();
	});
});
