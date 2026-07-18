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
		expect(listener).toHaveBeenLastCalledWith(true);

		observer?.emit(false);
		expect(listener).toHaveBeenLastCalledWith(false);
		observer?.emit(true);
		expect(listener).toHaveBeenLastCalledWith(true);

		dispose();
		expect(observer?.disconnect).toHaveBeenCalledOnce();
	});
});
