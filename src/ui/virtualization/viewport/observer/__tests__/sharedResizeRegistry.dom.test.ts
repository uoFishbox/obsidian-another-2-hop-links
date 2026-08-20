import { describe, expect, it, vi } from "vitest";
import {
	observeSharedResizeTarget,
	unobserveSharedResizeTarget,
	type SharedResizeObserverRegistry,
} from "../sharedResizeRegistry";

describe("sharedResizeObservers", () => {
	const createRegistry = <T>(): SharedResizeObserverRegistry<T> => ({
		observer: {
			observe: vi.fn(),
			unobserve: vi.fn(),
			disconnect: vi.fn(),
		} as unknown as ResizeObserver,
		subscribersByTarget: new Map(),
	});

	it("observes a target once for multiple subscribers", () => {
		const registry = createRegistry<object>();
		const target = document.createElement("div");
		const first = {};
		const second = {};

		observeSharedResizeTarget(registry, target, first);
		observeSharedResizeTarget(registry, target, second);

		expect(registry.observer.observe).toHaveBeenCalledTimes(1);
		expect(registry.subscribersByTarget.get(target)).toEqual(
			new Set([first, second]),
		);
	});

	it("disconnects when the last subscriber is removed", () => {
		const registry = createRegistry<object>();
		const target = document.createElement("div");
		const first = {};
		const second = {};
		const onEmpty = vi.fn();

		observeSharedResizeTarget(registry, target, first);
		observeSharedResizeTarget(registry, target, second);

		unobserveSharedResizeTarget(registry, target, first, onEmpty);
		expect(registry.observer.unobserve).not.toHaveBeenCalled();
		expect(onEmpty).not.toHaveBeenCalled();

		unobserveSharedResizeTarget(registry, target, second, onEmpty);
		expect(registry.observer.unobserve).toHaveBeenCalledWith(target);
		expect(registry.observer.disconnect).toHaveBeenCalledTimes(1);
		expect(onEmpty).toHaveBeenCalledTimes(1);
	});
});
