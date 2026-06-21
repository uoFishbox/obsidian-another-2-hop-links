import { describe, expect, it } from "vitest";
import { resolveScrollerViewportLifecycle } from "../scrollerViewportLifecycle";

describe("resolveScrollerViewportLifecycle", () => {
	it("represents idle observer connection state", () => {
		expect(
			resolveScrollerViewportLifecycle({
				isScrollActive: false,
				structureObserverConnected: true,
				needsObserverReconnectAfterScroll: false,
				needsDependencyRefreshAfterScroll: false,
				needsLayoutMeasurementAfterScroll: false,
			}),
		).toEqual({
			type: "idle",
			structureObserver: "connected",
		});
	});

	it("scopes pending flags to the scrolling state", () => {
		expect(
			resolveScrollerViewportLifecycle({
				isScrollActive: true,
				structureObserverConnected: false,
				needsObserverReconnectAfterScroll: true,
				needsDependencyRefreshAfterScroll: true,
				needsLayoutMeasurementAfterScroll: false,
			}),
		).toEqual({
			type: "scrolling",
			pendingAfterScroll: {
				reconnectStructureObserver: true,
				refreshDependencies: true,
				measureLayout: false,
			},
		});
	});

	it("represents disposed state explicitly", () => {
		expect(
			resolveScrollerViewportLifecycle({
				isDisposed: true,
				isScrollActive: false,
				structureObserverConnected: false,
				needsObserverReconnectAfterScroll: false,
				needsDependencyRefreshAfterScroll: false,
				needsLayoutMeasurementAfterScroll: false,
			}),
		).toEqual({ type: "disposed" });
	});
});
