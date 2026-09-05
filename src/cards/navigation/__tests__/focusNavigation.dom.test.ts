import { describe, expect, it, vi } from "vitest";
import { focusResultEdge } from "../focusNavigation";
import { getFocusableResultTarget } from "../resultTargets";

function createCard(id: string): HTMLButtonElement {
	const card = document.createElement("button");
	card.className = "cosense-card-links__box";
	card.dataset.cclInteractionHandle = id;
	card.scrollIntoView = vi.fn();
	return card;
}

describe("result focus boundaries", () => {
	it("focuses the first or last visible result without directional geometry", () => {
		const root = document.createElement("div");
		const first = createCard("first");
		const hidden = createCard("hidden");
		hidden.hidden = true;
		const last = createCard("last");
		root.append(first, hidden, last);
		document.body.append(root);

		expect(focusResultEdge(root, "down")).toBe(first);
		expect(document.activeElement).toBe(first);
		expect(focusResultEdge(root, "up")).toBe(last);
		expect(document.activeElement).toBe(last);
	});

	it("resolves a result target from a composed keyboard event", () => {
		const card = createCard("card");
		const child = document.createElement("span");
		card.append(child);
		const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
		Object.defineProperty(event, "composedPath", { value: () => [child, card] });

		expect(getFocusableResultTarget(event)).toBe(card);
	});
});
