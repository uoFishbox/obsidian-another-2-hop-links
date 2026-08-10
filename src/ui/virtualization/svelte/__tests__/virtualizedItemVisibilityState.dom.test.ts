import { describe, expect, it } from "vitest";
import type { RowRange } from "../../rowRange";
import {
	createVirtualizedItemVisibilityStateController,
	resolveVirtualizedItemVisibilityForPreviewRange,
} from "../virtualizedItemVisibilityState.svelte";

interface TestCell {
	readonly key: string;
	readonly cell: { readonly kind: "item" | "header" };
}

interface TestRow {
	readonly rowIndex: number;
	readonly cells: readonly TestCell[];
}

const item = (key: string): TestCell => ({ key, cell: { kind: "item" } });
const row = (rowIndex: number, cells: readonly TestCell[]): TestRow => ({
	rowIndex,
	cells,
});
const range = (start: number, end: number): RowRange => ({ start, end });

const commit = (
	controller: ReturnType<
		typeof createVirtualizedItemVisibilityStateController<TestCell>
	>,
	params: {
		readonly revision: unknown;
		readonly rows: readonly TestRow[];
		readonly mounted: RowRange;
		readonly preview: RowRange;
	},
): void => {
	controller.commit({
		rowModelRevision: params.revision,
		mountedRows: params.rows,
		mountedRange: params.mounted,
		previewActiveRange: params.preview,
	});
};

describe("resolveVirtualizedItemVisibilityForPreviewRange", () => {
	it("uses an end-exclusive preview range", () => {
		expect(resolveVirtualizedItemVisibilityForPreviewRange(1, range(1, 2))).toBe(
			"visible",
		);
		expect(resolveVirtualizedItemVisibilityForPreviewRange(2, range(1, 2))).toBe(
			"mounted",
		);
		expect(
			resolveVirtualizedItemVisibilityForPreviewRange(undefined, range(1, 2)),
		).toBe("mounted");
	});
});

describe("createVirtualizedItemVisibilityStateController", () => {
	it("exposes only the production commit and lookup contract", () => {
		const controller = createVirtualizedItemVisibilityStateController<TestCell>();

		expect(Object.keys(controller).sort()).toEqual(["commit", "getOrCreateState"]);
	});

	it("keeps state identity while a preview-only change updates visibility", () => {
		const controller = createVirtualizedItemVisibilityStateController<TestCell>();
		const first = item("first");
		const second = item("second");
		const rows = [row(0, [first]), row(1, [second])];
		const revision = {};

		commit(controller, {
			revision,
			rows,
			mounted: range(0, 2),
			preview: range(0, 1),
		});
		const firstState = controller.getOrCreateState(first, "visible");
		const secondState = controller.getOrCreateState(second, "mounted");

		commit(controller, {
			revision,
			rows,
			mounted: range(0, 2),
			preview: range(1, 2),
		});

		expect(controller.getOrCreateState(first, "visible")).toBe(firstState);
		expect(controller.getOrCreateState(second, "mounted")).toBe(secondState);
		expect(firstState.visibility).toBe("mounted");
		expect(secondState.visibility).toBe("visible");
	});

	it("retains a duplicate logical key while any mounted occurrence remains", () => {
		const controller = createVirtualizedItemVisibilityStateController<TestCell>();
		const firstOccurrence = item("shared");
		const secondOccurrence = item("shared");
		const revision = {};
		const initialRows = [row(0, [firstOccurrence]), row(1, [secondOccurrence])];

		commit(controller, {
			revision,
			rows: initialRows,
			mounted: range(0, 2),
			preview: range(0, 1),
		});
		const sharedState = controller.getOrCreateState(firstOccurrence, "visible");

		commit(controller, {
			revision,
			rows: [initialRows[1]],
			mounted: range(1, 2),
			preview: range(1, 2),
		});

		expect(controller.getOrCreateState(secondOccurrence, "visible")).toBe(
			sharedState,
		);
		expect(sharedState.visibility).toBe("visible");
	});

	it("retains state when a logical key moves between delta rows", () => {
		const controller = createVirtualizedItemVisibilityStateController<TestCell>();
		const moving = item("moving");
		const stable = item("stable");
		const revision = {};
		const initialRows = [row(0, [moving]), row(1, [stable])];

		commit(controller, {
			revision,
			rows: initialRows,
			mounted: range(0, 2),
			preview: range(0, 1),
		});
		const movingState = controller.getOrCreateState(moving, "visible");

		commit(controller, {
			revision,
			rows: [initialRows[1], row(2, [moving])],
			mounted: range(1, 3),
			preview: range(2, 3),
		});

		expect(controller.getOrCreateState(moving, "visible")).toBe(movingState);
		expect(movingState.visibility).toBe("visible");
	});

	it("drops state after the last mounted occurrence is removed", () => {
		const controller = createVirtualizedItemVisibilityStateController<TestCell>();
		const removed = item("removed");
		const revision = {};
		const initialRows = [row(0, [removed])];

		commit(controller, {
			revision,
			rows: initialRows,
			mounted: range(0, 1),
			preview: range(0, 1),
		});
		const removedState = controller.getOrCreateState(removed, "visible");

		commit(controller, {
			revision,
			rows: [row(1, [item("replacement")])],
			mounted: range(1, 2),
			preview: range(1, 2),
		});

		expect(controller.getOrCreateState(removed, "mounted")).not.toBe(removedState);
	});
});
