import type { ScrollerViewportScrollPhaseState } from "./scrollerViewportScrollPhase";

export interface ScrollerViewportPendingAfterScroll {
	readonly reconnectStructureObserver: boolean;
	readonly refreshDependencies: boolean;
	readonly measureLayout: boolean;
}

export type ScrollerViewportLifecycle =
	| {
			readonly type: "idle";
			readonly structureObserver: "connected" | "disconnected";
	  }
	| {
			readonly type: "scrolling";
			readonly pendingAfterScroll: ScrollerViewportPendingAfterScroll;
	  }
	| { readonly type: "disposed" };

export interface ScrollerViewportLifecycleFlags {
	readonly isDisposed?: boolean;
	readonly scrollPhaseState: ScrollerViewportScrollPhaseState;
	readonly structureObserverConnected: boolean;
}

export function resolveScrollerViewportLifecycle(
	flags: ScrollerViewportLifecycleFlags,
): ScrollerViewportLifecycle {
	if (flags.isDisposed) {
		return { type: "disposed" };
	}

	if (flags.scrollPhaseState.type === "scrolling") {
		return {
			type: "scrolling",
			pendingAfterScroll: {
				reconnectStructureObserver:
					flags.scrollPhaseState.pendingAfterScroll.reconnectObserver,
				refreshDependencies:
					flags.scrollPhaseState.pendingAfterScroll.refreshDependencies,
				measureLayout: flags.scrollPhaseState.pendingAfterScroll.measureLayout,
			},
		};
	}

	return {
		type: "idle",
		structureObserver: flags.structureObserverConnected
			? "connected"
			: "disconnected",
	};
}
