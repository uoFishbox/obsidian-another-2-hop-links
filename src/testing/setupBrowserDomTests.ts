import { vi } from "vitest";

if (typeof globalThis.requestAnimationFrame !== "function") {
	let nextFrameId = 1;
	const callbacks = new Map<number, FrameRequestCallback>();

	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const frameId = nextFrameId++;
		callbacks.set(frameId, callback);

		queueMicrotask(() => {
			const stored = callbacks.get(frameId);
			if (!stored) {
				return;
			}
			callbacks.delete(frameId);
			stored(Date.now());
		});

		return frameId;
	});

	vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
		callbacks.delete(frameId);
	});
}

if (typeof window !== "undefined") {
	if (typeof window.requestIdleCallback !== "function") {
		let nextIdleId = 1;
		const callbacks = new Map<number, IdleRequestCallback>();

		window.requestIdleCallback = ((callback: IdleRequestCallback) => {
			const idleId = nextIdleId++;
			callbacks.set(idleId, callback);

			queueMicrotask(() => {
				const stored = callbacks.get(idleId);
				if (!stored) {
					return;
				}
				callbacks.delete(idleId);
				stored({
					didTimeout: false,
					timeRemaining: () => 50,
				});
			});

			return idleId;
		}) as typeof window.requestIdleCallback;

		window.cancelIdleCallback = ((idleId: number) => {
			callbacks.delete(idleId);
		}) as typeof window.cancelIdleCallback;
	}

	if (typeof window.matchMedia !== "function") {
		window.matchMedia = ((query: string) =>
			({
				matches: false,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			})) as typeof window.matchMedia;
	}

	if (typeof window.ResizeObserver !== "function") {
		class ResizeObserverMock implements ResizeObserver {
			observe(): void {}
			unobserve(): void {}
			disconnect(): void {}
		}

		vi.stubGlobal("ResizeObserver", ResizeObserverMock);
	}
}

if (typeof URL.createObjectURL !== "function") {
	URL.createObjectURL = vi.fn(() => "blob:mock-url");
}

if (typeof URL.revokeObjectURL !== "function") {
	URL.revokeObjectURL = vi.fn();
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = vi.fn();
}
