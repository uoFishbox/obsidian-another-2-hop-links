import { afterEach, describe, expect, it, vi } from "vitest";
import {
	dispatchVirtualCellWillRebind,
	VIRTUAL_CELL_WILL_REBIND_EVENT,
} from "../virtualCellRebind";

describe("dispatchVirtualCellWillRebind", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("returns without dispatching for a cell with no transient state", () => {
		const cell = document.createElement("div");
		const interaction = document.createElement("button");
		interaction.dataset.cclInteractionId = "item:first";
		cell.append(interaction);
		document.body.append(cell);
		const listener = vi.fn();
		cell.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, listener);

		dispatchVirtualCellWillRebind(cell, {
			previousLogicalKey: "first",
			nextLogicalKey: "second",
		});

		expect(listener).not.toHaveBeenCalled();
		expect(interaction.dataset.cclInteractionId).toBe("item:first");
	});

	it("clears transient state and dispatches one event", () => {
		const cell = document.createElement("div");
		const hovered = document.createElement("button");
		const touched = document.createElement("button");
		hovered.dataset.cclHovered = "true";
		hovered.dataset.cclLongPressed = "1";
		touched.dataset.cclLastTouchAt = "123";
		cell.append(hovered, touched);
		document.body.append(cell);
		const listener = vi.fn();
		cell.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, listener);

		dispatchVirtualCellWillRebind(cell, {
			previousLogicalKey: "first",
			nextLogicalKey: "second",
		});

		expect(hovered.dataset.cclHovered).toBeUndefined();
		expect(hovered.dataset.cclLongPressed).toBeUndefined();
		expect(touched.dataset.cclLastTouchAt).toBeUndefined();
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("blurs a focused descendant without dispatching when no transient state exists", () => {
		const cell = document.createElement("div");
		const input = document.createElement("input");
		cell.append(input);
		document.body.append(cell);
		input.focus();
		const listener = vi.fn();
		cell.addEventListener(VIRTUAL_CELL_WILL_REBIND_EVENT, listener);

		dispatchVirtualCellWillRebind(cell, {
			previousLogicalKey: "first",
			nextLogicalKey: "second",
		});

		expect(document.activeElement).not.toBe(input);
		expect(listener).not.toHaveBeenCalled();
	});

	it("blurs a focused descendant inside a shadow root", () => {
		const host = document.createElement("div");
		const shadowRoot = host.attachShadow({ mode: "open" });
		const cell = document.createElement("div");
		const input = document.createElement("input");
		cell.append(input);
		shadowRoot.append(cell);
		document.body.append(host);
		input.focus();
		expect(shadowRoot.activeElement).toBe(input);

		dispatchVirtualCellWillRebind(cell, {
			previousLogicalKey: "first",
			nextLogicalKey: "second",
		});

		expect(shadowRoot.activeElement).not.toBe(input);
	});
});
