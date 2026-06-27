import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFocusableResultTarget, moveFocusBetweenResults } from "../resultFocus";

type WindowWithKeyboardEventConstructor = Window & {
	KeyboardEvent: typeof KeyboardEvent;
};

function createZeroRect(): DOMRect {
	return {
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		width: 0,
		height: 0,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} satisfies DOMRect;
}

function makeVisibleButUnmeasured(element: HTMLElement): void {
	const rect = createZeroRect();
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => rect,
	});
	Object.defineProperty(element, "getClientRects", {
		configurable: true,
		value: () =>
			({
				length: 1,
				item: () => rect,
				[Symbol.iterator]: function* () {
					yield rect;
				},
			}) as DOMRectList,
	});
}

function createVirtualCell({
	left,
	top,
	width = 120,
	height = 48,
}: {
	left: number;
	top: number;
	width?: number;
	height?: number;
}): HTMLElement {
	const cell = document.createElement("div");
	cell.className = "view-plan-virtual-list-cell";
	cell.style.transform = `translate(${left}px, ${top}px)`;
	cell.style.width = `${width}px`;
	cell.style.height = `${height}px`;
	return cell;
}

function createVirtualResult({
	id,
	left,
	top,
}: {
	id: string;
	left: number;
	top: number;
}): HTMLElement {
	const cell = createVirtualCell({ left, top });
	const card = document.createElement("div");
	card.className = "cosense-card-links__box";
	card.dataset.cclInteractionId = id;
	card.tabIndex = -1;
	makeVisibleButUnmeasured(card);
	Object.defineProperty(card, "focus", {
		configurable: true,
		value: vi.fn(),
	});
	Object.defineProperty(card, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
	cell.append(card);
	return cell;
}

describe("moveFocusBetweenResults", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("uses the virtual cell transform when the card rect is unavailable", () => {
		const root = document.createElement("div");
		root.className = "view-plan-virtual-list";

		const currentCell = createVirtualResult({
			id: "current",
			left: 16,
			top: 12,
		});
		const nextCell = createVirtualResult({
			id: "next",
			left: 160,
			top: 12,
		});
		root.append(currentCell, nextCell);
		document.body.append(root);

		const current = currentCell.querySelector<HTMLElement>(
			'[data-ccl-interaction-id="current"]',
		);
		const next = nextCell.querySelector<HTMLElement>(
			'[data-ccl-interaction-id="next"]',
		);
		const nextFocusSpy = vi.spyOn(next!, "focus");
		const nextScrollSpy = vi.spyOn(next!, "scrollIntoView");

		const result = moveFocusBetweenResults(root, current, "right");

		expect(result).toBe(next);
		expect(nextFocusSpy).toHaveBeenCalledWith({ preventScroll: true });
		expect(nextScrollSpy).toHaveBeenCalledWith({
			block: "nearest",
			inline: "nearest",
		});
	});

	it("resolves a focus target from a foreign-window keyboard event", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const frameDocument = frame.contentDocument;
		const frameWindow = frame.contentWindow;
		expect(frameDocument).toBeTruthy();
		expect(frameWindow).toBeTruthy();
		if (!frameDocument || !frameWindow) {
			return;
		}

		const card = frameDocument.createElement("div");
		card.className = "cosense-card-links__box";
		card.dataset.cclInteractionId = "foreign-card";
		frameDocument.body.append(card);

		const event = new (
			frameWindow as WindowWithKeyboardEventConstructor
		).KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			composed: true,
		});
		Object.defineProperty(event, "target", {
			configurable: true,
			value: card,
		});
		Object.defineProperty(event, "composedPath", {
			configurable: true,
			value: () => [card, frameDocument.body, frameDocument, frameWindow],
		});

		expect(getFocusableResultTarget(event)).toBe(card);
	});
});
