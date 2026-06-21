import { describe, expect, it } from "vitest";
import {
	readVirtualListSharedScrollMetrics,
	resolveCachedViewportHeight,
} from "../sharedScrollMetrics";

describe("sharedScrollMetrics", () => {
	it("uses the cached viewport height from the active subscriber", () => {
		expect(
			resolveCachedViewportHeight({
				isDisposed: false,
				getCachedViewportHeight: () => 320,
			}),
		).toBe(320);
	});

	it("ignores missing, disposed, and invalid cached viewport heights", () => {
		expect(resolveCachedViewportHeight(null)).toBeNull();
		expect(
			resolveCachedViewportHeight({
				isDisposed: true,
				getCachedViewportHeight: () => 320,
			}),
		).toBeNull();
		expect(
			resolveCachedViewportHeight({
				isDisposed: false,
				getCachedViewportHeight: () => 0,
			}),
		).toBeNull();
	});

	it("reads metrics from an element scroller", () => {
		const scroller = document.createElement("div");
		Object.defineProperty(scroller, "scrollTop", {
			value: 120,
			configurable: true,
		});
		Object.defineProperty(scroller, "clientHeight", {
			value: 240,
			configurable: true,
		});

		expect(
			readVirtualListSharedScrollMetrics({
				scroller,
				subscriber: null,
				isScrollActive: true,
				frameId: 7,
			}),
		).toEqual({
			scrollTop: 120,
			viewportHeight: 240,
			frameId: 7,
			isScrollActive: true,
		});
	});
});
