import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "ui/shared/scroll/scrollActivity";
import type { VirtualScrollMeasurementReason } from "../../runtime/measurementTypes";

const SCROLL_IDLE_MS = 140;

export interface VirtualScrollSessionState {
	ownerWindow: Window;
	scrollTarget: Window | HTMLElement;
	scrollActivitySource: object;
	isScrolling: boolean;
	refreshDependenciesAfterScroll: boolean;
	measureLayoutAfterScroll: boolean;
	idleTimer: number | null;
	lastScrollEventAt: number;
	onScrollIdleTimeout: () => void;
	pendingScrollTop: number | null;
	scrollGeneration: number;
	hasPendingScrollMeasurement: boolean;
}

export interface VirtualScrollSessionActions {
	cancelInitialStabilizationMeasurement(): void;
	onScrollStart(): void;
	notifyScrollStateChange(): void;
	scheduleDependencyObserverRefresh(): void;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(reason?: VirtualScrollMeasurementReason): void;
	isWithinScrollMeasurementRange(scrollTop: number): boolean;
}

const readScrollTop = (target: Window | HTMLElement): number =>
	"document" in target ? target.scrollY || target.pageYOffset || 0 : target.scrollTop;

const readMonotonicTime = (ownerWindow: Window): number =>
	ownerWindow.performance.now();

const startScrollSession = (
	state: VirtualScrollSessionState,
	actions: VirtualScrollSessionActions,
): void => {
	if (state.isScrolling) {
		return;
	}

	state.isScrolling = true;
	state.refreshDependenciesAfterScroll = false;
	state.measureLayoutAfterScroll = false;
	markScrollActivityActive(state.scrollActivitySource);
	actions.cancelInitialStabilizationMeasurement();
	actions.onScrollStart();
	actions.notifyScrollStateChange();
};

const finishScrollPhase = (
	state: VirtualScrollSessionState,
	actions: VirtualScrollSessionActions,
): void => {
	if (!state.isScrolling) {
		return;
	}

	const refreshDependencies = state.refreshDependenciesAfterScroll;
	const measureLayout = state.measureLayoutAfterScroll;
	state.isScrolling = false;
	state.refreshDependenciesAfterScroll = false;
	state.measureLayoutAfterScroll = false;

	markScrollActivityIdle(state.scrollActivitySource);
	if (refreshDependencies) {
		actions.scheduleDependencyObserverRefresh();
	}
	if (measureLayout) {
		actions.scheduleLayoutMeasurement();
	} else {
		actions.scheduleScrollMeasurement("scroll-idle");
	}
	actions.notifyScrollStateChange();
};

const finishScrollIdle = (
	state: VirtualScrollSessionState,
	actions: VirtualScrollSessionActions,
): void => {
	if (!state.isScrolling) {
		return;
	}

	if (state.idleTimer !== null) {
		state.ownerWindow.clearTimeout(state.idleTimer);
	}
	state.idleTimer = null;
	state.pendingScrollTop = null;
	finishScrollPhase(state, actions);
};

/**
 * Advances idle detection for one scroll session. The timer remains the single
 * source of truth because native scrollend can split rAF-driven gestures.
 */
export function checkVirtualScrollIdle(
	state: VirtualScrollSessionState,
	actions: VirtualScrollSessionActions,
): void {
	state.idleTimer = null;
	const elapsed = readMonotonicTime(state.ownerWindow) - state.lastScrollEventAt;
	const remaining = SCROLL_IDLE_MS - elapsed;
	if (remaining > 0) {
		state.idleTimer = state.ownerWindow.setTimeout(
			state.onScrollIdleTimeout,
			remaining,
		);
		return;
	}

	finishScrollIdle(state, actions);
}

/** Handles one native scroll event for a scroller-owned session. */
export function handleVirtualScrollEvent(
	state: VirtualScrollSessionState,
	actions: VirtualScrollSessionActions,
): void {
	state.lastScrollEventAt = readMonotonicTime(state.ownerWindow);
	const scrollTop = readScrollTop(state.scrollTarget);

	if (!state.isScrolling) {
		startScrollSession(state, actions);
	}
	state.pendingScrollTop = scrollTop;
	state.scrollGeneration += 1;
	if (state.idleTimer === null) {
		state.idleTimer = state.ownerWindow.setTimeout(
			state.onScrollIdleTimeout,
			SCROLL_IDLE_MS,
		);
	}

	if (state.hasPendingScrollMeasurement) {
		return;
	}

	if (actions.isWithinScrollMeasurementRange(scrollTop)) {
		return;
	}
	actions.scheduleScrollMeasurement();
}
