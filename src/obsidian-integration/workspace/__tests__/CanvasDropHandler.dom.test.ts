import { describe, expect, it, vi, beforeEach } from "vitest";

const eventHandlers = new Map<string, (leaf?: { view: unknown } | null) => void>();

vi.mock("obsidian", () => {
	class FileView {
		public getViewType(): string {
			return "markdown";
		}
	}

	class TFile {}

	class App {}

	return {
		App,
		FileView,
		TFile,
	};
});

import { CanvasDropManager } from "../CanvasDropHandler";

function createCanvasView(wrapperEl: HTMLElement) {
	return {
		getViewType: () => "canvas",
		canvas: {
			wrapperEl,
			posFromEvt: vi.fn(),
			createFileNode: vi.fn(),
			pushHistory: vi.fn(),
			getData: vi.fn(),
		},
	};
}

describe("CanvasDropManager", () => {
	beforeEach(() => {
		eventHandlers.clear();
		document.body.innerHTML = "";
	});

	it("prunes disconnected canvas listeners on layout changes", () => {
		const canvasEl = document.createElement("div");
		document.body.appendChild(canvasEl);
		const removeEventListenerSpy = vi.spyOn(canvasEl, "removeEventListener");
		const canvasView = createCanvasView(canvasEl);
		const leaves = [{ view: canvasView }];
		const workspace = {
			iterateAllLeaves: (callback: (leaf: { view: unknown }) => void) =>
				leaves.forEach(callback),
			on: vi.fn(
				(
					event: string,
					callback: (leaf?: { view: unknown } | null) => void,
				) => {
					eventHandlers.set(event, callback);
					return { event, callback };
				},
			),
		};
		const app = {
			workspace,
		};
		const manager = new CanvasDropManager(app as never);

		manager.registerCanvasDropHandler(() => {});

		expect((manager as any).registeredListeners.size).toBe(1);

		canvasEl.remove();
		eventHandlers.get("layout-change")?.();

		expect(removeEventListenerSpy).toHaveBeenCalledTimes(2);
		expect((manager as any).registeredListeners.size).toBe(0);
	});

	it("syncs handlers for canvas leaves during registration", () => {
		const canvasEl = document.createElement("div");
		document.body.appendChild(canvasEl);
		const canvasView = createCanvasView(canvasEl);
		const leaves = [
			{ view: { getViewType: () => "markdown" } },
			{ view: canvasView },
		];
		const workspace = {
			iterateAllLeaves: (callback: (leaf: { view: unknown }) => void) =>
				leaves.forEach(callback),
			on: vi.fn(
				(
					event: string,
					callback: (leaf?: { view: unknown } | null) => void,
				) => {
					eventHandlers.set(event, callback);
					return { event, callback };
				},
			),
		};
		const app = {
			workspace,
		};
		const manager = new CanvasDropManager(app as never);

		manager.registerCanvasDropHandler(() => {});

		expect((manager as any).registeredListeners.size).toBe(1);
		expect(eventHandlers.has("layout-change")).toBe(true);
	});
});
