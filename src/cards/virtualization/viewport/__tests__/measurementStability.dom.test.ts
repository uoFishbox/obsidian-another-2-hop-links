import { describe, expect, it } from "vitest";
import {
	hasValidCachedVirtualListScrollMetrics,
	hasValidVirtualListScrollMetrics,
	resolveVirtualListLayoutStability,
} from "../measurement";
import { createDomRect, setNumericProperty } from "testing/helpers/DOMObserverMock";

describe("virtual list measurement stability", () => {
	it("treats empty content as stable without requiring layout metrics", () => {
		expect(
			hasValidVirtualListScrollMetrics({
				hasRenderableContent: false,
				rootRect: createDomRect({ top: 0, width: 0, height: 0 }),
				viewportHeight: 0,
				scrollTop: Number.NaN,
				sectionTop: Number.NaN,
			}),
		).toBe(true);
		expect(
			hasValidCachedVirtualListScrollMetrics(
				false,
				false,
				0,
				Number.NaN,
				0,
				Number.NaN,
			),
		).toBe(true);
	});

	it("requires finite live and cached metrics for renderable content", () => {
		expect(
			hasValidVirtualListScrollMetrics({
				hasRenderableContent: true,
				rootRect: createDomRect({ top: 0, width: 320, height: 240 }),
				viewportHeight: 600,
				scrollTop: 10,
				sectionTop: 20,
			}),
		).toBe(true);
		expect(
			hasValidCachedVirtualListScrollMetrics(true, true, 600, 10, 600, 20),
		).toBe(true);
		expect(
			hasValidVirtualListScrollMetrics({
				hasRenderableContent: true,
				rootRect: createDomRect({ top: 0, width: 320, height: 0 }),
				viewportHeight: 600,
				scrollTop: 10,
				sectionTop: 20,
			}),
		).toBe(false);
		expect(
			hasValidCachedVirtualListScrollMetrics(true, false, 600, 10, 600, 20),
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
			hasValidWidth: true,
			hasValidRootRect: true,
			isLayoutGeometryStable: true,
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
			}).isLayoutGeometryStable,
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
			}).isLayoutGeometryStable,
		).toBe(false);
	});
});
