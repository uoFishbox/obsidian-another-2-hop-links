import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createCardSurfaceNavigation,
	findMountedCellElementByKey,
} from "../surfaceNavigation";
import { createVirtualCellBindingRegistry } from "../cellBindingRegistry";

function createSequentialSurface(physicalOrder: readonly number[]) {
	const root = document.createElement("div");
	const content = document.createElement("div");
	root.append(content);
	document.body.append(root);

	const registry = createVirtualCellBindingRegistry();
	const cards = new Map<number, HTMLElement>();
	for (const logicalIndex of physicalOrder) {
		const cell = document.createElement("div");
		const card = document.createElement("div");
		card.className = "cosense-card-links__box";
		card.tabIndex = 0;
		cell.append(card);
		content.append(cell);
		registry.rebindCell(cell, {
			nextLogicalKey: String(logicalIndex),
			rowIndex: logicalIndex,
			columnIndex: 0,
		});
		cards.set(logicalIndex, card);
	}

	const handlers = createCardSurfaceNavigation({
		getRootEl: () => null,
		getContentEl: () => content,
		getScrollContainerEl: () => null,
		getRowHeight: () => 10,
		delegatedInteractions: { handleKeyDown: vi.fn() },
		cellBindingRegistry: registry,
		flushMountedState: async () => {},
		resolveSequentialNavigationTarget: (currentKey, direction) => {
			const currentIndex = Number(currentKey);
			const targetIndex =
				direction === "forward" ? currentIndex + 1 : currentIndex - 1;
			if (targetIndex < 0 || targetIndex >= physicalOrder.length) return null;
			return {
				key: String(targetIndex),
				rowTop: targetIndex * 10,
				rowIndex: targetIndex,
				columnIndex: 0,
			};
		},
	});

	return { root, content, registry, cards, handlers };
}

function createTabEvent(target: HTMLElement, shiftKey = false): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key: "Tab",
		shiftKey,
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	Object.defineProperty(event, "composedPath", {
		configurable: true,
		value: () => [target, target.parentElement],
	});
	return event;
}

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("findMountedCellElementByKey", () => {
	it("returns null for empty lookup keys", () => {
		const container = document.createElement("div");
		const registry = createVirtualCellBindingRegistry();

		expect(findMountedCellElementByKey(container, null, registry)).toBeNull();
		expect(findMountedCellElementByKey(container, undefined, registry)).toBeNull();
		expect(findMountedCellElementByKey(container, "", registry)).toBeNull();
	});

	it("finds mounted cell elements through the in-memory registry", () => {
		const container = document.createElement("div");
		const cell = document.createElement("div");
		container.append(cell);

		const registry = createVirtualCellBindingRegistry();
		registry.rebindCell(cell, {
			nextLogicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		expect(findMountedCellElementByKey(container, "registered-a", registry)).toBe(
			cell,
		);

		const closest = registry.findClosestCell(cell);
		expect(closest?.element).toBe(cell);
		expect(closest?.metadata).toEqual({
			logicalKey: "registered-a",
			rowIndex: 1,
			columnIndex: 2,
		});

		registry.releaseCell(cell);

		expect(
			findMountedCellElementByKey(container, "registered-a", registry),
		).toBeNull();
		expect(registry.findClosestCell(cell)).toBeNull();
	});
});

describe("sequential virtual focus", () => {
	it("moves Tab by logical cell order instead of recycled DOM order", async () => {
		const { cards, handlers } = createSequentialSurface([2, 3, 0, 1]);
		const current = cards.get(1)!;
		const next = cards.get(2)!;
		const focusSpy = vi.spyOn(next, "focus");
		const event = createTabEvent(current);

		await handlers.handleKeyDown(event);

		expect(event.defaultPrevented).toBe(true);
		expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("temporarily removes recycled tab stops at a logical edge so native Tab exits", async () => {
		vi.useFakeTimers();
		const { cards, handlers } = createSequentialSurface([2, 3, 0, 1]);
		const event = createTabEvent(cards.get(3)!);

		await handlers.handleKeyDown(event);

		expect(event.defaultPrevented).toBe(false);
		expect(cards.get(3)?.tabIndex).toBe(0);
		expect(
			Array.from(cards.entries())
				.filter(([logicalIndex]) => logicalIndex !== 3)
				.every(([, card]) => card.tabIndex === -1),
		).toBe(true);
		vi.runAllTimers();
		expect(Array.from(cards.values()).every((card) => card.tabIndex === 0)).toBe(
			true,
		);
	});

	it("redirects external focus entry to the logical mounted edge", () => {
		const before = document.createElement("button");
		document.body.prepend(before);
		const { root, content, registry, cards } = createSequentialSurface([
			2, 3, 0, 1,
		]);
		const logicalFirst = cards.get(0)!;
		const physicalFirst = cards.get(2)!;
		const focusSpy = vi.spyOn(logicalFirst, "focus");
		const handlers = createCardSurfaceNavigation({
			getRootEl: () => root,
			getContentEl: () => content,
			getScrollContainerEl: () => null,
			getRowHeight: () => 10,
			delegatedInteractions: { handleKeyDown: vi.fn() },
			cellBindingRegistry: registry,
			flushMountedState: async () => {},
			resolveSequentialNavigationTarget: () => null,
		});
		const event = new FocusEvent("focusin", {
			bubbles: true,
			composed: true,
			relatedTarget: before,
		});
		Object.defineProperty(event, "composedPath", {
			configurable: true,
			value: () => [physicalFirst, physicalFirst.parentElement],
		});

		handlers.handleFocusIn(event);

		expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
	});
});
