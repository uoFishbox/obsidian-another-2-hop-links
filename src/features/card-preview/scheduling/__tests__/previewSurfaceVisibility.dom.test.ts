import { afterEach, describe, expect, it, vi } from "vitest";
import { observePreviewSurfaceVisibility } from "../previewSurfaceVisibility";

class IntersectionObserverMock {
	static latest: IntersectionObserverMock | undefined;
	readonly observe = vi.fn();
	readonly disconnect = vi.fn();

	constructor(private readonly callback: IntersectionObserverCallback) {
		IntersectionObserverMock.latest = this;
	}

	emit(isIntersecting: boolean): void {
		this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
	}
}

describe("observePreviewSurfaceVisibility", () => {
	const originalIntersectionObserver = window.IntersectionObserver;

	afterEach(() => {
		Reflect.set(window, "IntersectionObserver", originalIntersectionObserver);
		IntersectionObserverMock.latest = undefined;
		document.body.replaceChildren();
	});

	it("tracks the containing workspace pane intersection", () => {
		Reflect.set(window, "IntersectionObserver", IntersectionObserverMock);
		const pane = document.createElement("div");
		pane.className = "workspace-leaf-content";
		const surface = document.createElement("div");
		pane.append(surface);
		document.body.append(pane);
		const listener = vi.fn();

		const dispose = observePreviewSurfaceVisibility(surface, listener);
		const observer = IntersectionObserverMock.latest;
		expect(observer?.observe).toHaveBeenCalledWith(pane);
		expect(listener).toHaveBeenLastCalledWith(false);

		observer?.emit(false);
		expect(listener).toHaveBeenLastCalledWith(false);
		observer?.emit(true);
		expect(listener).toHaveBeenLastCalledWith(true);

		dispose();
		expect(observer?.disconnect).toHaveBeenCalledOnce();
	});

	it("falls back to document visibility when IntersectionObserver is unavailable", () => {
		Reflect.set(window, "IntersectionObserver", undefined);
		const surface = document.createElement("div");
		document.body.append(surface);
		const listener = vi.fn();

		const dispose = observePreviewSurfaceVisibility(surface, listener);

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenLastCalledWith(true);
		dispose();
	});
	it("rebinds document-owned observers after the surface moves to a popout", () => {
		Reflect.set(window, "IntersectionObserver", IntersectionObserverMock);
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		const foreignWindow = frame.contentWindow;
		expect(foreignDocument).toBeTruthy();
		expect(foreignWindow).toBeTruthy();
		if (!foreignDocument || !foreignWindow) return;

		let foreignObserver: IntersectionObserverMock | undefined;
		class ForeignIntersectionObserver extends IntersectionObserverMock {
			constructor(callback: IntersectionObserverCallback) {
				super(callback);
				foreignObserver = this;
			}
		}
		Reflect.set(foreignWindow, "IntersectionObserver", ForeignIntersectionObserver);

		const mainPane = document.createElement("div");
		mainPane.className = "workspace-leaf-content";
		const surface = document.createElement("div");
		mainPane.append(surface);
		document.body.append(mainPane);
		let migrate: ((ownerWindow: Window) => void) | undefined;
		const unregister = vi.fn();
		Object.defineProperty(surface, "onWindowMigrated", {
			configurable: true,
			value: vi.fn((listener: (ownerWindow: Window) => void) => {
				migrate = listener;
				return unregister;
			}),
		});

		const dispose = observePreviewSurfaceVisibility(surface, vi.fn());
		const mainObserver = IntersectionObserverMock.latest;
		expect(mainObserver?.observe).toHaveBeenCalledWith(mainPane);

		const foreignPane = foreignDocument.createElement("div");
		foreignPane.className = "workspace-leaf-content";
		foreignPane.append(surface);
		foreignDocument.body.append(foreignPane);
		migrate?.(foreignWindow);

		expect(mainObserver?.disconnect).toHaveBeenCalledOnce();
		expect(foreignObserver?.observe).toHaveBeenCalledWith(foreignPane);
		dispose();
		expect(foreignObserver?.disconnect).toHaveBeenCalledOnce();
		expect(unregister).toHaveBeenCalledOnce();
	});
});
