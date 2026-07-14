import { describe, expect, it, vi } from "vitest";
import {
	VIRTUAL_CELL_WILL_REBIND_EVENT,
	markVirtualCellInteractionDirty,
	prepareVirtualCellForRebind,
	type VirtualCellWillRebindDetail,
} from "../virtualCellRebind";

describe("virtual cell rebind", () => {
	it("does not inspect or notify a clean physical cell", () => {
		const cell = document.createElement("div");
		const querySelectorAll = vi.spyOn(cell, "querySelectorAll");
		const dispatchEvent = vi.spyOn(cell, "dispatchEvent");

		const prepared = prepareVirtualCellForRebind(cell, "first", "second");

		expect(prepared).toBe(false);
		expect(querySelectorAll).not.toHaveBeenCalled();
		expect(dispatchEvent).not.toHaveBeenCalled();
	});

	it("clears and notifies a dirty physical cell only once", () => {
		const cell = document.createElement("div");
		const interaction = document.createElement("button");
		interaction.dataset.cclInteractionId = "item:first";
		interaction.dataset.cclHovered = "true";
		interaction.dataset.cclLongPressed = "1";
		interaction.dataset.cclLastTouchAt = "123";
		cell.append(interaction);
		document.body.append(cell);
		interaction.focus();

		const details: VirtualCellWillRebindDetail[] = [];
		cell.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, (event) => {
			details.push((event as CustomEvent<VirtualCellWillRebindDetail>).detail);
		});
		markVirtualCellInteractionDirty(cell);

		expect(prepareVirtualCellForRebind(cell, "first", "second")).toBe(true);
		expect(document.activeElement).not.toBe(interaction);
		expect(interaction.dataset.cclHovered).toBeUndefined();
		expect(interaction.dataset.cclLongPressed).toBeUndefined();
		expect(interaction.dataset.cclLastTouchAt).toBeUndefined();
		expect(details).toEqual([
			{
				previousLogicalKey: "first",
				nextLogicalKey: "second",
			},
		]);

		expect(prepareVirtualCellForRebind(cell, "second", "third")).toBe(false);
		expect(details).toHaveLength(1);
	});
});
