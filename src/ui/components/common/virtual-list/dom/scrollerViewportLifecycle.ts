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
	readonly isScrollActive: boolean;
	readonly structureObserverConnected: boolean;
	readonly needsObserverReconnectAfterScroll: boolean;
	readonly needsDependencyRefreshAfterScroll: boolean;
	readonly needsLayoutMeasurementAfterScroll: boolean;
}

export function resolveScrollerViewportLifecycle(
	flags: ScrollerViewportLifecycleFlags,
): ScrollerViewportLifecycle {
	if (flags.isDisposed) {
		return { type: "disposed" };
	}

	if (flags.isScrollActive) {
		return {
			type: "scrolling",
			pendingAfterScroll: {
				reconnectStructureObserver: flags.needsObserverReconnectAfterScroll,
				refreshDependencies: flags.needsDependencyRefreshAfterScroll,
				measureLayout: flags.needsLayoutMeasurementAfterScroll,
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
