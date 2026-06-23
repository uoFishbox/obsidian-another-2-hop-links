import { describe, expect, it } from "vitest";
import {
	isStableCachedVirtualListMeasurement,
	isStableVirtualListMeasurement,
	resolveVirtualListLayoutStability,
} from "../virtualListMeasurementStability";
import { createDomRect, setNumericProperty } from "testing/helpers/DOMObserverMock";

describe("virtual list measurement stability", () => {
	it("treats empty content as stable without requiring layout metrics", () => {
		expect(
			isStableVirtualListMeasurement({
				hasRenderableContent: false,
				rootRect: createDomRect({ top: 0, width: 0, height: 0 }),
				viewportHeight: 0,
				scrollTop: Number.NaN,
				sectionTop: Number.NaN,
			}),
		).toBe(true);
		expect(
			isStableCachedVirtualListMeasurement({
				hasRenderableContent: false,
				hasStableCachedScrollMetrics: false,
				cachedViewportHeight: 0,
				scrollSnapshot: {
					scrollTop: Number.NaN,
					viewportHeight: 0,
				},
				cachedSectionTop: Number.NaN,
			}),
		).toBe(true);
	});

	it("requires finite live and cached metrics for renderable content", () => {
		expect(
			isStableVirtualListMeasurement({
				hasRenderableContent: true,
				rootRect: createDomRect({ top: 0, width: 320, height: 240 }),
				viewportHeight: 600,
				scrollTop: 10,
				sectionTop: 20,
			}),
		).toBe(true);
		expect(
			isStableCachedVirtualListMeasurement({
				hasRenderableContent: true,
				hasStableCachedScrollMetrics: true,
				cachedViewportHeight: 600,
				scrollSnapshot: {
					scrollTop: 10,
					viewportHeight: 600,
				},
				cachedSectionTop: 20,
			}),
		).toBe(true);
		expect(
			isStableVirtualListMeasurement({
				hasRenderableContent: true,
				rootRect: createDomRect({ top: 0, width: 320, height: 0 }),
				viewportHeight: 600,
				scrollTop: 10,
				sectionTop: 20,
			}),
		).toBe(false);
		expect(
			isStableCachedVirtualListMeasurement({
				hasRenderableContent: true,
				hasStableCachedScrollMetrics: false,
				cachedViewportHeight: 600,
				scrollSnapshot: {
					scrollTop: 10,
					viewportHeight: 600,
				},
				cachedSectionTop: 20,
			}),
		).toBe(false);
	});

	it("resolves layout stability from measured width, root rect, and client width", () => {
		const rootEl = document.createElement("div");
		setNumericProperty(rootEl, "clientWidth", 320);

		expect(
			resolveVirtualListLayoutStability({
				rootEl,
				rootRect: createDomRect({
					top: 0,
					width: 0,
					height: 240,
				}),
				measuredWidth: 0,
				hasRenderableContent: true,
			}),
		).toEqual({
			rawContainerWidth: 0,
			hasStableWidth: true,
			hasStableRootRect: true,
			isStable: true,
		});
	});

	it("requires positive root height only when content is renderable", () => {
		const rootEl = document.createElement("div");
		setNumericProperty(rootEl, "clientWidth", 0);

		expect(
			resolveVirtualListLayoutStability({
				rootEl,
				rootRect: createDomRect({
					top: 0,
					width: 0,
					height: 0,
				}),
				measuredWidth: undefined,
				hasRenderableContent: false,
			}).isStable,
		).toBe(true);

		expect(
			resolveVirtualListLayoutStability({
				rootEl,
				rootRect: createDomRect({
					top: 0,
					width: 320,
					height: 0,
				}),
				measuredWidth: undefined,
				hasRenderableContent: true,
			}).isStable,
		).toBe(false);
	});
});
