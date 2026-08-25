import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "shared/ui/scroll/scrollActivity";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import {
	readVirtualListSharedScrollMetricsInto,
	resolveCachedViewportHeight,
	type VirtualListSharedScrollMetrics,
} from "../measurement";

export type VirtualScrollMeasurementReason =
	| "scroll-coverage-miss"
	| "scroll-idle"
	| "data-change"
	| "post-layout";

/** Open scrollTop interval in which another scroll measurement is unnecessary. */
export interface ScrollMeasurementRange {
	readonly minScrollTopBeforeMeasurement: number;
	readonly maxScrollTopBeforeMeasurement: number;
}

export interface ScrollCoverageGate {
	valid: boolean;
	min: number;
	max: number;
}

export function isWithinScrollCoverageGate(
	gate: ScrollCoverageGate,
	scrollTop: number,
): boolean {
	return gate.valid && scrollTop > gate.min && scrollTop < gate.max;
}

export function publishScrollCoverageGate(
	gate: ScrollCoverageGate,
	range: ScrollMeasurementRange | null,
): void {
	if (!range) {
		gate.valid = false;
		return;
	}

	gate.valid = true;
	gate.min = range.minScrollTopBeforeMeasurement;
	gate.max = range.maxScrollTopBeforeMeasurement;
}

export interface ObserveVirtualViewportOptions {
	rootEl: HTMLElement;
	frameCoordinator: VirtualFrameCoordinator;
	onWidthChange: (width: number) => void;
	/** Whether root height-only resize entries should schedule layout work. */
	measureOnRootHeightChange?: boolean;
	getCachedViewportHeight?: () => number;
	getScrollMeasurementRange?: () => ScrollMeasurementRange | null;
	onScrollContainerChange: (element: HTMLElement | null) => void;
	scheduleLayoutMeasurement: () => void;
	scheduleScrollMeasurement: (task?: () => void) => void;
	runScrollMeasurement: (
		metrics?: VirtualListSharedScrollMetrics,
		reason?: VirtualScrollMeasurementReason,
	) => void;
	runInitialLayoutMeasurement: () => void;
	/** Resets observation-scoped measurement state before each realm bind. */
	resetMeasurementForObservation?: () => void;
	cancelInitialStabilizationMeasurement?: () => void;
	onScrollStateChange?: (
		generation: number,
		hasPendingScrollTop: boolean,
		isScrollActive: boolean,
	) => void;
	onScrollStart?: () => void;
}

export interface VirtualViewportObservation {
	(): void;
	publishScrollMeasurementRange(range: ScrollMeasurementRange | null): void;
	/** Suppresses one matching native scroll event already handled programmatically. */
	suppressNextNativeScroll(scrollTop: number): void;
}

export interface VirtualViewportSubscriber extends Omit<
	ObserveVirtualViewportOptions,
	"rootEl"
> {
	rootEl: HTMLElement;
	ownerWindow: Window;
	entry: ScrollerViewportEntry;
	lastObservedWidth: number | null;
	lastObservedHeight: number | null;
	isDisposed: boolean;
}

/** Mutable state owned by one scroll container and its active subscriber. */
export interface ScrollerViewportEntry {
	registryKey: Window | HTMLElement;
	scroller: HTMLElement | null;
	ownerWindow: Window;
	structureMutationObserver: MutationObserver;
	subscriber: VirtualViewportSubscriber | null;
	hasPendingScrollMeasurement: boolean;
	scrollMeasurementReason: VirtualScrollMeasurementReason;
	structureDependencyTargets: Set<Node>;
	positionDependencyElements: Set<HTMLElement>;
	scrollActivitySource: object;
	sharedScrollMetricsScratch: VirtualListSharedScrollMetrics;
	pendingScrollTop: number | null;
	scrollGeneration: number;
	scrollCoverageGate: ScrollCoverageGate;
	scrollTarget: Window | HTMLElement;
	isScrolling: boolean;
	refreshDependenciesAfterScroll: boolean;
	measureLayoutAfterScroll: boolean;
	layoutMeasurementPendingForDependencyRefresh: boolean;
	structureObserverConnected: boolean;
	idleTimer: number | null;
	lastScrollEventAt: number;
	onNativeScroll: () => void;
	onScrollIdleTimeout: () => void;
	unsubscribeWindowResize: (() => void) | null;
	runDependencyObserverRefresh: () => void;
}

const DEPENDENCY_REFRESH_LANE = "animation-frame" as const;
const DEPENDENCY_REFRESH_TASK_KEY = "virtual-list:dependency-refresh";
let scrollMeasurementFrameId = 0;

export function getActiveSubscriber(
	entry: ScrollerViewportEntry,
): VirtualViewportSubscriber | null {
	const { subscriber } = entry;
	return !subscriber || subscriber.isDisposed ? null : subscriber;
}

export function scheduleDependencyObserverRefresh(entry: ScrollerViewportEntry): void {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) return;
	subscriber.frameCoordinator.schedule(
		DEPENDENCY_REFRESH_LANE,
		DEPENDENCY_REFRESH_TASK_KEY,
		entry.runDependencyObserverRefresh,
	);
}

export function cancelDependencyObserverRefresh(
	subscriber: VirtualViewportSubscriber,
): void {
	subscriber.frameCoordinator.cancel(
		DEPENDENCY_REFRESH_LANE,
		DEPENDENCY_REFRESH_TASK_KEY,
	);
}

export function scheduleLayoutMeasurement(entry: ScrollerViewportEntry): void {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) return;

	subscriber.scheduleLayoutMeasurement();
}

export function notifyScrollStateChange(entry: ScrollerViewportEntry): void {
	getActiveSubscriber(entry)?.onScrollStateChange?.(
		entry.scrollGeneration,
		entry.pendingScrollTop !== null,
		entry.isScrolling,
	);
}

export function isWithinScrollMeasurementRange(
	entry: ScrollerViewportEntry,
	scrollTop: number,
): boolean {
	return isWithinScrollCoverageGate(entry.scrollCoverageGate, scrollTop);
}

export function publishScrollMeasurementRange(
	entry: ScrollerViewportEntry,
	range: ScrollMeasurementRange | null,
): void {
	publishScrollCoverageGate(entry.scrollCoverageGate, range);
}

export function readSharedScrollMetrics(
	entry: ScrollerViewportEntry,
): VirtualListSharedScrollMetrics {
	const pendingScrollTop = entry.pendingScrollTop;
	if (pendingScrollTop !== null) {
		entry.pendingScrollTop = null;
		const out = entry.sharedScrollMetricsScratch;
		out.scrollTop = pendingScrollTop;
		out.viewportHeight =
			resolveCachedViewportHeight(getActiveSubscriber(entry)) ??
			out.viewportHeight;
		out.frameId = ++scrollMeasurementFrameId;
		out.isScrollActive = entry.isScrolling;
		out.scrollGeneration = entry.scrollGeneration;
		notifyScrollStateChange(entry);
		return out;
	}

	const subscriber = getActiveSubscriber(entry);
	return readVirtualListSharedScrollMetricsInto(entry.sharedScrollMetricsScratch, {
		scroller: entry.scroller,
		subscriber,
		ownerElement: subscriber?.rootEl ?? null,
		frameId: ++scrollMeasurementFrameId,
		isScrollActive: entry.isScrolling,
		scrollGeneration: entry.scrollGeneration,
	});
}

export function scheduleScrollMeasurement(
	entry: ScrollerViewportEntry,
	reason: VirtualScrollMeasurementReason = "scroll-coverage-miss",
): void {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber || entry.hasPendingScrollMeasurement) return;

	entry.hasPendingScrollMeasurement = true;
	entry.scrollMeasurementReason = reason;
	subscriber.scheduleScrollMeasurement(() => {
		if (!entry.hasPendingScrollMeasurement) return;

		entry.hasPendingScrollMeasurement = false;
		const activeSubscriber = getActiveSubscriber(entry);
		if (!activeSubscriber) return;
		if (
			entry.scrollMeasurementReason === "scroll-coverage-miss" &&
			entry.pendingScrollTop !== null &&
			isWithinScrollMeasurementRange(entry, entry.pendingScrollTop)
		) {
			notifyScrollStateChange(entry);
			return;
		}
		activeSubscriber.runScrollMeasurement(
			readSharedScrollMetrics(entry),
			entry.scrollMeasurementReason,
		);
	});
}

const SCROLL_IDLE_MS = 80;
const SUPPRESSED_NATIVE_SCROLL_EPSILON_PX = 0.5;

export interface VirtualScrollSessionState {
	ownerWindow: Window;
	scrollTarget: Window | HTMLElement;
	scrollActivitySource: object;
	isScrolling: boolean;
	refreshDependenciesAfterScroll: boolean;
	measureLayoutAfterScroll: boolean;
	idleTimer: number | null;
	lastScrollEventAt: number;
	suppressedNativeScrollTop: number | null;
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
	const scrollTop = readScrollTop(state.scrollTarget);
	const suppressedScrollTop = state.suppressedNativeScrollTop;
	if (suppressedScrollTop !== null) {
		state.suppressedNativeScrollTop = null;
		if (
			!state.isScrolling &&
			Math.abs(scrollTop - suppressedScrollTop) <=
				SUPPRESSED_NATIVE_SCROLL_EPSILON_PX
		) {
			return;
		}
	}

	state.lastScrollEventAt = readMonotonicTime(state.ownerWindow);

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
