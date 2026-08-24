import { describe, expect, it, vi, beforeEach } from "vitest";
import { KeyboardCardNavigator } from "../KeyboardCardNavigator";
import { MarkdownView } from "obsidian";

vi.mock("obsidian", () => {
	class MarkdownView {
		containerEl: HTMLElement;

		constructor() {
			this.containerEl = document.createElement("div");
		}
	}

	class ItemView {
		containerEl: HTMLElement;

		constructor() {
			this.containerEl = document.createElement("div");
		}
	}

	return {
		ItemView,
		MarkdownView,
		Notice: vi.fn(),
	};
});

vi.mock("two-hop/ui/TwoHopLinksView", () => ({
	TWO_HOP_LINKS_VIEW_TYPE: "cosense-card-links-view",
}));

type RectInit = {
	top: number;
	left: number;
	width?: number;
	height?: number;
};

function setVisibleRect(
	element: HTMLElement,
	{ top, left, width = 120, height = 48 }: RectInit,
): void {
	const rect = {
		top,
		left,
		width,
		height,
		right: left + width,
		bottom: top + height,
		x: left,
		y: top,
		toJSON: () => ({}),
	} satisfies DOMRect;

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
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		value: height,
	});
	Object.defineProperty(element, "clientWidth", {
		configurable: true,
		value: width,
	});
}

function createCard(id: string, rect: RectInit): HTMLElement {
	const card = document.createElement("div");
	card.className = "cosense-card-links__box";
	card.dataset.cclInteractionId = id;
	setVisibleRect(card, rect);
	return card;
}

function createLoadMoreButton(rect: RectInit): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "cosense-card-links__load-more-button cosense-card-links__box";
	button.setAttribute("aria-label", "Load more");
	setVisibleRect(button, rect);
	return button;
}

function createSurface(
	host: "inline" | "sidebar" | "empty",
	cards: HTMLElement[] = [],
): HTMLElement {
	const surface = document.createElement("div");
	surface.className =
		host === "empty" ? "cosense-card-links-empty-view" : "cosense-card-links__root";
	surface.dataset.cclCardSurface = host;
	surface.tabIndex = -1;
	setVisibleRect(surface, { top: 0, left: 0, width: 600, height: 400 });
	for (const card of cards) {
		surface.append(card);
	}
	return surface;
}

function createWorkspace(options: {
	activeView?: MarkdownView | null;
	sidebarContainers?: HTMLElement[];
	emptyViewContainers?: HTMLElement[];
}) {
	return {
		activeLeaf: options.activeView ? { view: options.activeView } : undefined,
		getActiveViewOfType: vi.fn((type: new (...args: any[]) => unknown) => {
			if (!options.activeView) {
				return null;
			}

			return options.activeView instanceof type ? options.activeView : null;
		}),
		getLeavesOfType: vi.fn(() =>
			(options.sidebarContainers ?? []).map((contentEl) => ({
				view: { contentEl },
			})),
		),
		iterateAllLeaves: vi.fn((callback: (leaf: any) => void) => {
			for (const contentEl of options.emptyViewContainers ?? []) {
				callback({
					view: {
						contentEl,
						getViewType: () => "empty",
					},
				});
			}
		}),
	};
}

function dispatchKey(key: string, options?: { target?: HTMLElement }) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	if (options?.target) {
		Object.defineProperty(event, "target", {
			value: options.target,
		});
	}
	document.dispatchEvent(event);
}

function getSelectedCard(root: HTMLElement): HTMLElement | null {
	return root.querySelector<HTMLElement>("[data-ccl-kb-row-selected]");
}

function getHintForElement(
	root: HTMLElement,
	interactionId: string,
): string | undefined {
	const el = root.querySelector<HTMLElement>(
		`[data-ccl-interaction-id="${interactionId}"]`,
	);
	return el?.dataset.cclKbHint;
}

function hasAnyHints(root: HTMLElement): boolean {
	return root.querySelector<HTMLElement>("[data-ccl-kb-hint]") !== null;
}

describe("KeyboardCardNavigator", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	describe("surface resolution", () => {
		it("prefers the active markdown editor surface over the sidebar surface", () => {
			const inlineCard = createCard("inline-card", {
				top: 10,
				left: 20,
			});
			const inlineSurface = createSurface("inline", [inlineCard]);
			const sidebarCard = createCard("sidebar-card", {
				top: 10,
				left: 20,
			});
			const sidebarSurface = createSurface("sidebar", [sidebarCard]);
			const activeView = new MarkdownView({} as never);
			activeView.containerEl.append(inlineSurface);
			document.body.append(activeView.containerEl);

			const sidebarContainer = document.createElement("div");
			sidebarContainer.append(sidebarSurface);
			document.body.append(sidebarContainer);

			const workspace = createWorkspace({
				activeView,
				sidebarContainers: [sidebarContainer],
			});
			const navigator = new KeyboardCardNavigator({ workspace }, vi.fn());

			expect(navigator.resolveTargetSurface()).toEqual({
				rootEl: inlineSurface,
				host: "inline",
			});
		});

		it("falls back to sidebar when active editor surface has no cards", () => {
			const activeView = new MarkdownView({} as never);
			const emptyInlineSurface = createSurface("inline", []);
			activeView.containerEl.append(emptyInlineSurface);
			document.body.append(activeView.containerEl);
			const sidebarCard = createCard("sidebar-card", {
				top: 10,
				left: 20,
			});
			const sidebarSurface = createSurface("sidebar", [sidebarCard]);
			const sidebarContainer = document.createElement("div");
			sidebarContainer.append(sidebarSurface);
			document.body.append(sidebarContainer);
			const workspace = createWorkspace({
				activeView,
				sidebarContainers: [sidebarContainer],
			});
			const navigator = new KeyboardCardNavigator({ workspace }, vi.fn());

			expect(navigator.resolveTargetSurface()).toEqual({
				rootEl: sidebarSurface,
				host: "sidebar",
			});
		});

		it("falls back to sidebar when inline surface has only non-navigable elements", () => {
			const activeView = new MarkdownView({} as never);
			const inlineSurface = createSurface("inline");
			const nonCard = document.createElement("div");
			nonCard.className = "some-other-class";
			inlineSurface.append(nonCard);
			activeView.containerEl.append(inlineSurface);
			document.body.append(activeView.containerEl);

			const sidebarCard = createCard("sidebar-card", {
				top: 10,
				left: 20,
			});
			const sidebarSurface = createSurface("sidebar", [sidebarCard]);
			const sidebarContainer = document.createElement("div");
			sidebarContainer.append(sidebarSurface);
			document.body.append(sidebarContainer);

			const workspace = createWorkspace({
				activeView,
				sidebarContainers: [sidebarContainer],
			});
			const navigator = new KeyboardCardNavigator({ workspace }, vi.fn());

			expect(navigator.resolveTargetSurface()).toEqual({
				rootEl: sidebarSurface,
				host: "sidebar",
			});
		});
	});

	describe("row collection", () => {
		it("groups visible cards into rows by top position and sorts each row left-to-right", () => {
			const root = createSurface("inline", [
				createCard("row-1-b", { top: 12, left: 240 }),
				createCard("row-2-a", { top: 92, left: 20 }),
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-b", { top: 95, left: 210 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			const rows = navigator.collectVisibleRows(root);

			expect(rows).toHaveLength(2);
			expect(rows[0].cards.map((card) => card.dataset.cclInteractionId)).toEqual([
				"row-1-a",
				"row-1-b",
			]);
			expect(rows[1].cards.map((card) => card.dataset.cclInteractionId)).toEqual([
				"row-2-a",
				"row-2-b",
			]);
		});

		it("collects visible rows from cards rendered inside shadow roots", () => {
			const root = createSurface("inline");
			const shadowRoot = root.attachShadow({ mode: "open" });
			shadowRoot.append(
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-1-b", { top: 12, left: 240 }),
				createCard("row-2-a", { top: 92, left: 20 }),
			);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			const rows = navigator.collectVisibleRows(root);

			expect(rows).toHaveLength(2);
			expect(rows[0].cards.map((card) => card.dataset.cclInteractionId)).toEqual([
				"row-1-a",
				"row-1-b",
			]);
			expect(rows[1].cards.map((card) => card.dataset.cclInteractionId)).toEqual([
				"row-2-a",
			]);
		});
	});

	describe("keyboard navigation", () => {
		it("selects the first row on activation and assigns hints to visible cards", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-1-b", { top: 10, left: 180 }),
				createCard("row-2-a", { top: 90, left: 20 }),
				createCard("row-2-b", { top: 90, left: 180 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			navigator.activate(root, "inline");

			expect(root.classList.contains("ccl-kb-nav-active")).toBe(true);
			expect(getSelectedCard(root)?.dataset.cclInteractionId).toBe("row-1-a");
			expect(hasAnyHints(root)).toBe(true);
		});

		it("moves selection down with ArrowDown", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");

			dispatchKey("ArrowDown");

			expect(getSelectedCard(root)?.dataset.cclInteractionId).toBe("row-2-a");
		});

		it("moves selection up with ArrowUp", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");
			dispatchKey("ArrowDown");

			dispatchKey("ArrowUp");

			expect(getSelectedCard(root)?.dataset.cclInteractionId).toBe("row-1-a");
		});

		it("exits navigation mode on Escape", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");

			dispatchKey("Escape");

			expect(root.classList.contains("ccl-kb-nav-active")).toBe(false);
			expect(getSelectedCard(root)).toBeNull();
		});

		it("ignores arrow keys from editable elements", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			const input = document.createElement("input");
			root.append(input);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");

			dispatchKey("ArrowDown", { target: input });

			expect(getSelectedCard(root)?.dataset.cclInteractionId).toBe("row-1-a");
		});

		it("ignores keys when modifiers are pressed", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");

			const event = new KeyboardEvent("keydown", {
				key: "ArrowDown",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			});
			document.dispatchEvent(event);

			expect(getSelectedCard(root)?.dataset.cclInteractionId).toBe("row-1-a");
		});
	});

	describe("hint-based activation", () => {
		it("activates a card by its hint key", () => {
			const targetListener = vi.fn();
			const rowOneA = createCard("row-1-a", { top: 10, left: 20 });
			const rowOneB = createCard("row-1-b", { top: 10, left: 180 });
			rowOneB.addEventListener("click", targetListener);

			const root = createSurface("inline", [
				rowOneA,
				rowOneB,
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			navigator.activate(root, "inline");
			const hintB = getHintForElement(root, "row-1-b");
			expect(hintB).toBeDefined();

			navigator.activateCardByHint(hintB!);

			expect(targetListener).toHaveBeenCalledTimes(1);
			expect(root.classList.contains("ccl-kb-nav-active")).toBe(false);
			expect(getSelectedCard(root)).toBeNull();
		});

		it("does nothing for an invalid hint key", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");
			const initialSelected = getSelectedCard(root);

			navigator.activateCardByHint("z");

			expect(getSelectedCard(root)).toBe(initialSelected);
			expect(root.classList.contains("ccl-kb-nav-active")).toBe(true);
		});

		it("activates load more button by hint and stays in keyboard mode", async () => {
			const scrollContainer = document.createElement("div");
			scrollContainer.style.overflowY = "auto";
			setVisibleRect(scrollContainer, {
				top: 0,
				left: 0,
				width: 640,
				height: 140,
			});

			const firstRowCard = createCard("row-1-a", { top: 46, left: 20 });
			const loadMoreButton = createLoadMoreButton({ top: 126, left: 20 });
			const root = createSurface("inline", [firstRowCard, loadMoreButton]);
			scrollContainer.append(root);
			document.body.append(scrollContainer);

			const onExpand = vi.fn(() => {
				loadMoreButton.remove();
				root.append(createCard("row-2-a", { top: 126, left: 20 }));
			});
			loadMoreButton.addEventListener("click", onExpand);

			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			navigator.activate(root, "inline");
			dispatchKey("ArrowDown");

			expect(getSelectedCard(root)).toBe(loadMoreButton);
			const loadMoreHint = loadMoreButton.dataset.cclKbHint;
			expect(loadMoreHint).toBeDefined();
			expect(onExpand).not.toHaveBeenCalled();

			navigator.activateCardByHint(loadMoreHint!);

			await vi.waitFor(() => {
				expect(onExpand).toHaveBeenCalledTimes(1);
			});
			expect(root.classList.contains("ccl-kb-nav-active")).toBe(true);
		});

		it("dispatches composed synthetic click from shadow-rendered card", () => {
			const root = createSurface("inline");
			const shadowRoot = root.attachShadow({ mode: "open" });

			const card = createCard("shadow-card", { top: 10, left: 20 });
			shadowRoot.append(card);

			const delegatedClick = vi.fn();
			root.addEventListener("click", delegatedClick);

			document.body.append(root);

			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			navigator.activate(root, "inline");
			const hint = card.dataset.cclKbHint;
			expect(hint).toBeDefined();

			navigator.activateCardByHint(hint!);

			expect(delegatedClick).toHaveBeenCalledTimes(1);
		});
	});

	describe("scroll behavior", () => {
		it("keeps the selected row centered in the nearest scroll container", () => {
			const scrollContainer = document.createElement("div");
			scrollContainer.style.overflowY = "auto";
			setVisibleRect(scrollContainer, {
				top: 0,
				left: 0,
				width: 640,
				height: 100,
			});

			const root = createSurface("inline", [
				createCard("row-1-a", { top: 26, left: 20 }),
				createCard("row-2-a", { top: 126, left: 20 }),
			]);
			scrollContainer.append(root);
			document.body.append(scrollContainer);

			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);

			navigator.activate(root, "inline");
			expect(scrollContainer.scrollTop).toBe(0);

			navigator.moveRow(1);

			expect(scrollContainer.scrollTop).toBe(100);
		});
	});

	describe("deactivation", () => {
		it("cleans up selection state and class on deactivate", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
				createCard("row-2-a", { top: 90, left: 20 }),
			]);
			document.body.append(root);
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");
			expect(root.classList.contains("ccl-kb-nav-active")).toBe(true);

			navigator.deactivate();

			expect(root.classList.contains("ccl-kb-nav-active")).toBe(false);
			expect(getSelectedCard(root)).toBeNull();
		});
	});
	describe("window migration", () => {
		it("rebinds the keydown listener to the migrated surface document", () => {
			const root = createSurface("inline", [
				createCard("row-1-a", { top: 10, left: 20 }),
			]);
			document.body.append(root);
			let migrate: ((ownerWindow: Window) => void) | undefined;
			const unregister = vi.fn();
			Object.defineProperty(root, "onWindowMigrated", {
				configurable: true,
				value: vi.fn((listener: (ownerWindow: Window) => void) => {
					migrate = listener;
					return unregister;
				}),
			});
			const navigator = new KeyboardCardNavigator(
				{ workspace: createWorkspace({}) },
				vi.fn(),
			);
			navigator.activate(root, "inline");

			const frame = document.createElement("iframe");
			document.body.append(frame);
			const foreignDocument = frame.contentDocument;
			const foreignWindow = frame.contentWindow;
			expect(foreignDocument).toBeTruthy();
			expect(foreignWindow).toBeTruthy();
			if (!foreignDocument || !foreignWindow) return;

			foreignDocument.body.append(root);
			migrate?.(foreignWindow);

			const foreignEventWindow = foreignWindow as Window & {
				KeyboardEvent: typeof KeyboardEvent;
			};

			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
			expect(root.classList.contains("ccl-kb-nav-active")).toBe(true);

			foreignDocument.dispatchEvent(
				new foreignEventWindow.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
			expect(root.classList.contains("ccl-kb-nav-active")).toBe(false);
			expect(unregister).toHaveBeenCalledOnce();
		});
	});
});
