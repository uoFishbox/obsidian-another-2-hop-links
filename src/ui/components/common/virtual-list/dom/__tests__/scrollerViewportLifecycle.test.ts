import { describe, expect, it } from "vitest";
import { resolveScrollerViewportLifecycle } from "../scrollerViewportLifecycle";

describe("resolveScrollerViewportLifecycle", () => {
	it("represents idle observer connection state", () => {
		expect(
			resolveScrollerViewportLifecycle({
				scrollPhaseState: { type: "idle" },
				structureObserverConnected: true,
			}),
		).toEqual({
			type: "idle",
			structureObserver: "connected",
		});
	});

	it("scopes pending flags to the scrolling state", () => {
		expect(
			resolveScrollerViewportLifecycle({
				scrollPhaseState: {
					type: "scrolling",
					pendingAfterScroll: {
						reconnectObserver: true,
						refreshDependencies: true,
						measureLayout: false,
					},
				},
				structureObserverConnected: false,
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
				scrollPhaseState: { type: "idle" },
				structureObserverConnected: false,
			}),
		).toEqual({ type: "disposed" });
	});
});
