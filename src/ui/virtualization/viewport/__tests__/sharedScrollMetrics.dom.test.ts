import { describe, expect, it } from "vitest";
import {
	readVirtualListSharedScrollMetricsInto,
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

		const out = {
			scrollTop: 0,
			viewportHeight: 0,
			frameId: 0,
			isScrollActive: false,
			scrollGeneration: 0,
		};
		const result = readVirtualListSharedScrollMetricsInto(out, {
			scroller,
			subscriber: null,
			isScrollActive: true,
			frameId: 7,
			scrollGeneration: 3,
		});

		expect(result).toBe(out);
		expect(out).toEqual({
			scrollTop: 120,
			viewportHeight: 240,
			frameId: 7,
			isScrollActive: true,
			scrollGeneration: 3,
		});
	});

	it("reads metrics into the provided output object", () => {
		const scroller = document.createElement("div");
		Object.defineProperty(scroller, "scrollTop", {
			value: 180,
			configurable: true,
		});
		Object.defineProperty(scroller, "clientHeight", {
			value: 360,
			configurable: true,
		});
		const out = {
			scrollTop: 0,
			viewportHeight: 0,
			frameId: 0,
			isScrollActive: false,
			scrollGeneration: 0,
		};

		const result = readVirtualListSharedScrollMetricsInto(out, {
			scroller,
			subscriber: null,
			isScrollActive: true,
			frameId: 8,
			scrollGeneration: 4,
		});

		expect(result).toBe(out);
		expect(out).toEqual({
			scrollTop: 180,
			viewportHeight: 360,
			frameId: 8,
			isScrollActive: true,
			scrollGeneration: 4,
		});
	});
});
