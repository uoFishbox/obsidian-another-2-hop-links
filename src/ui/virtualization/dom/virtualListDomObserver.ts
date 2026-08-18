import {
	findNearestScrollContainerCached,
	invalidateNearestScrollContainerCache,
} from "./scrollContainer";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "ui/virtualization/scheduling/scrollActivity";
import { subscribeWindowResize } from "ui/virtualization/scheduling/windowResizeListeners";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	markCCLDevPerformance,
	recordCCLDevMeasurement,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	collectPositionDependencyElements,
	collectStructureDependencyTargets,
} from "./scrollContainerDependencies";
import {
	observeSharedResizeTarget,
	unobserveSharedResizeTarget,
	type SharedResizeObserverRegistry,
} from "./sharedResizeObservers";
import {
	readVirtualListSharedScrollMetricsInto,
	resolveCachedViewportHeight,
	type VirtualListSharedScrollMetrics,
} from "./sharedScrollMetrics";
import { hasRelevantStructureMutation } from "./structureMutationObserver";
import { getOptionalOwnerWindow, isHTMLElementLike } from "ui/shared/dom/realmSafeDom";
import type { VirtualScrollMeasurementReason } from "./virtualMeasurement";

export type { VirtualListSharedScrollMetrics } from "./sharedScrollMetrics";

/** Open scrollTop interval in which another scroll measurement is unnecessary. */
export interface ScrollMeasurementRange {
	readonly minScrollTopBeforeMeasurement: number;
	readonly maxScrollTopBeforeMeasurement: number;
}

export interface ObserveVirtualListViewportOptions {
	rootEl: HTMLElement;
	frameCoordinator: VirtualFrameCoordinator;
	onWidthChange: (width: number) => void;
	/** Whether root height-only resize entries should schedule layout work. */
	measureOnRootHeightChange?: boolean;
	getCachedViewportHeight?: () => number;
	/**
	 * Returns the initial open interval that does not require measurement.
	 * Later ranges must be pushed through the returned observation.
	 */
	getScrollMeasurementRange?: () => ScrollMeasurementRange | null;
	onScrollContainerChange: (element: HTMLElement | null) => void;
	scheduleLayoutMeasurement: () => void;
	/**
	 * Schedules an observer-owned metrics consumer on the controller scheduler.
	 * The task is retained when layout work temporarily supersedes scroll work.
	 */
	scheduleScrollMeasurement: (task?: () => void) => void;
	runScrollMeasurement: (
		metrics?: VirtualListSharedScrollMetrics,
		reason?: VirtualScrollMeasurementReason,
	) => void;
	runInitialLayoutMeasurement: () => void;
	cancelInitialStabilizationMeasurement?: () => void;
	/** Publishes observer-owned scroll state used to gate post-layout work. */
	onScrollStateChange?: (
		generation: number,
		hasPendingScrollTop: boolean,
		isScrollActive: boolean,
	) => void;
	/**
	 * Invoked once when a scroll gesture starts (scroll "start" phase). Used to
	 * prime layout measurement when scroll metrics are still unstable, so the
	 * first scroll frame does not fall back to repeated unstable retries.
	 */
	onScrollStart?: () => void;
}

export interface VirtualListViewportObservation {
	(): void;
	/** Publishes the range produced by the latest completed measurement. */
	publishScrollMeasurementRange(range: ScrollMeasurementRange | null): void;
}

const ROOT_RESIZE_EPSILON_PX = 0.5;
const SCROLL_IDLE_MS = 140;
const DEPENDENCY_REFRESH_LANE = "animation-frame" as const;
const DEPENDENCY_REFRESH_TASK_KEY = "virtual-list:dependency-refresh";

interface ScrollCoverageGate {
	valid: boolean;
	min: number;
	max: number;
}

interface VirtualListViewportSubscriber extends Omit<
	ObserveVirtualListViewportOptions,
	"rootEl"
> {
	rootEl: HTMLElement;
	ownerWindow: Window;
	entry: ScrollerViewportEntry;
	lastObservedWidth: number | null;
	lastObservedHeight: number | null;
	isDisposed: boolean;
}

/**
 * Mutable state owned by one scroller viewport. A scroller entry has at most
 * one active virtual-list subscriber; the WeakMap still scopes entries by
 * scroller so separate scrollers remain isolated.
 */
interface ScrollerViewportEntry {
	registryKey: HTMLElement;
	scroller: HTMLElement | null;
	ownerWindow: Window;
	structureMutationObserver: MutationObserver;
	subscriber: VirtualListViewportSubscriber | null;
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
	reconnectStructureObserverAfterScroll: boolean;
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

const scrollerViewportEntries = new WeakMap<HTMLElement, ScrollerViewportEntry>();
let scrollMeasurementFrameId = 0;

type SharedRootResizeObserver =
	SharedResizeObserverRegistry<VirtualListViewportSubscriber>;

type SharedLayoutDependencyResizeObserver =
	SharedResizeObserverRegistry<ScrollerViewportEntry>;

type WindowObserverConstructors = Window & {
	ResizeObserver?: typeof ResizeObserver;
	MutationObserver?: typeof MutationObserver;
};

const sharedRootResizeObservers = new WeakMap<Window, SharedRootResizeObserver>();
const sharedLayoutDependencyResizeObservers = new WeakMap<
	Window,
	SharedLayoutDependencyResizeObserver
>();

const getResizeObserverConstructor = (ownerWindow: Window): typeof ResizeObserver =>
	(ownerWindow as WindowObserverConstructors).ResizeObserver ?? ResizeObserver;

const getMutationObserverConstructor = (ownerWindow: Window): typeof MutationObserver =>
	(ownerWindow as WindowObserverConstructors).MutationObserver ?? MutationObserver;

const readScrollTop = (target: Window | HTMLElement): number =>
	"document" in target ? target.scrollY || target.pageYOffset || 0 : target.scrollTop;

const readMonotonicTime = (ownerWindow: Window): number =>
	ownerWindow.performance.now();

const getActiveSubscriber = (
	entry: ScrollerViewportEntry,
): VirtualListViewportSubscriber | null => {
	const { subscriber } = entry;
	if (!subscriber || subscriber.isDisposed) {
		return null;
	}

	return subscriber;
};

const scheduleDependencyObserverRefresh = (entry: ScrollerViewportEntry): void => {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) return;
	subscriber.frameCoordinator.schedule(
		DEPENDENCY_REFRESH_LANE,
		DEPENDENCY_REFRESH_TASK_KEY,
		entry.runDependencyObserverRefresh,
	);
};

const cancelDependencyObserverRefresh = (
	subscriber: VirtualListViewportSubscriber,
): void => {
	subscriber.frameCoordinator.cancel(
		DEPENDENCY_REFRESH_LANE,
		DEPENDENCY_REFRESH_TASK_KEY,
	);
};

const scheduleLayoutMeasurement = (entry: ScrollerViewportEntry): void => {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) {
		return;
	}

	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("virtualList.observer.layoutTask.scheduled");
	}
	subscriber.scheduleLayoutMeasurement();
};

const scheduleScrollMeasurement = (
	entry: ScrollerViewportEntry,
	reason: VirtualScrollMeasurementReason = "scroll-coverage-miss",
): void => {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) {
		return;
	}
	if (entry.hasPendingScrollMeasurement) {
		// Preserve the reason owned by the already-registered consumer.
		return;
	}

	entry.hasPendingScrollMeasurement = true;
	entry.scrollMeasurementReason = reason;
	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("virtualList.observer.scrollTask.scheduled");
	}
	subscriber.scheduleScrollMeasurement(() => {
		if (!entry.hasPendingScrollMeasurement) {
			return;
		}

		entry.hasPendingScrollMeasurement = false;
		const activeSubscriber = getActiveSubscriber(entry);
		if (!activeSubscriber) {
			return;
		}
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualList.observer.scrollTask.executed");
		}
		if (
			entry.scrollMeasurementReason === "scroll-coverage-miss" &&
			entry.pendingScrollTop !== null &&
			isWithinScrollMeasurementRange(entry, entry.pendingScrollTop)
		) {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement(
					"virtualList.observer.scrollTask.skippedRecoveredCoverage",
				);
			}
			notifyScrollStateChange(entry);
			return;
		}
		activeSubscriber.runScrollMeasurement(
			readSharedScrollMetrics(entry),
			entry.scrollMeasurementReason,
		);
	});
};

const notifyScrollStateChange = (entry: ScrollerViewportEntry): void => {
	getActiveSubscriber(entry)?.onScrollStateChange?.(
		entry.scrollGeneration,
		entry.pendingScrollTop !== null,
		entry.isScrolling,
	);
};

const isWithinScrollMeasurementRange = (
	entry: ScrollerViewportEntry,
	scrollTop: number,
): boolean => {
	const { scrollCoverageGate } = entry;
	return (
		scrollCoverageGate.valid &&
		scrollTop > scrollCoverageGate.min &&
		scrollTop < scrollCoverageGate.max
	);
};

const publishScrollMeasurementRange = (
	entry: ScrollerViewportEntry,
	range: ScrollMeasurementRange | null,
): void => {
	if (!range) {
		entry.scrollCoverageGate.valid = false;
		return;
	}

	entry.scrollCoverageGate.valid = true;
	entry.scrollCoverageGate.min = range.minScrollTopBeforeMeasurement;
	entry.scrollCoverageGate.max = range.maxScrollTopBeforeMeasurement;
};

const readSharedScrollMetrics = (
	entry: ScrollerViewportEntry,
): VirtualListSharedScrollMetrics => {
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
		ownerElement: subscriber?.rootEl ?? entry.registryKey,
		frameId: ++scrollMeasurementFrameId,
		isScrollActive: entry.isScrolling,
		scrollGeneration: entry.scrollGeneration,
	});
};

const disconnectStructureObserver = (entry: ScrollerViewportEntry): void => {
	if (!entry.structureObserverConnected) {
		return;
	}

	entry.structureMutationObserver.disconnect();
	entry.structureObserverConnected = false;
};

const connectStructureObserver = (entry: ScrollerViewportEntry): void => {
	if (entry.structureObserverConnected) {
		return;
	}

	for (const target of entry.structureDependencyTargets) {
		entry.structureMutationObserver.observe(target, {
			childList: true,
		});
	}

	entry.structureObserverConnected = true;
};

const scheduleLayoutMeasurementWhenIdle = (entry: ScrollerViewportEntry): void => {
	if (entry.isScrolling) {
		entry.measureLayoutAfterScroll = true;
		return;
	}

	scheduleLayoutMeasurement(entry);
};

const scheduleLayoutMeasurementForResizeEntries = (
	sharedObserver: SharedLayoutDependencyResizeObserver,
	entries: readonly ResizeObserverEntry[],
): void => {
	const entriesToMeasure = new Set<ScrollerViewportEntry>();

	for (const resizeEntry of entries) {
		const target = resizeEntry.target;
		if (!isHTMLElementLike(target)) {
			continue;
		}

		const scrollerEntries = sharedObserver.subscribersByTarget.get(target);
		if (!scrollerEntries) {
			continue;
		}

		for (const entry of scrollerEntries) {
			entriesToMeasure.add(entry);
		}
	}

	for (const entry of entriesToMeasure) {
		scheduleLayoutMeasurementWhenIdle(entry);
	}
};

const getSharedRootResizeObserver = (ownerWindow: Window): SharedRootResizeObserver => {
	const existing = sharedRootResizeObservers.get(ownerWindow);
	if (existing) {
		return existing;
	}

	const ResizeObserverCtor = getResizeObserverConstructor(ownerWindow);
	const sharedObserver: SharedRootResizeObserver = {
		observer: new ResizeObserverCtor((entries: ResizeObserverEntry[]) => {
			for (const resizeEntry of entries) {
				if (!isHTMLElementLike(resizeEntry.target)) {
					continue;
				}

				const subscribers = sharedObserver.subscribersByTarget.get(
					resizeEntry.target,
				);
				if (!subscribers) {
					continue;
				}

				for (const subscriber of Array.from(subscribers)) {
					handleRootResizeEntry(subscriber, resizeEntry.contentRect);
				}
			}
		}),
		subscribersByTarget: new Map<HTMLElement, Set<VirtualListViewportSubscriber>>(),
	};
	sharedRootResizeObservers.set(ownerWindow, sharedObserver);
	return sharedObserver;
};

const getSharedLayoutDependencyResizeObserver = (
	ownerWindow: Window,
): SharedLayoutDependencyResizeObserver => {
	const existing = sharedLayoutDependencyResizeObservers.get(ownerWindow);
	if (existing) {
		return existing;
	}

	const ResizeObserverCtor = getResizeObserverConstructor(ownerWindow);
	const sharedObserver: SharedLayoutDependencyResizeObserver = {
		observer: new ResizeObserverCtor((entries: ResizeObserverEntry[]) => {
			scheduleLayoutMeasurementForResizeEntries(sharedObserver, entries);
		}),
		subscribersByTarget: new Map<HTMLElement, Set<ScrollerViewportEntry>>(),
	};
	sharedLayoutDependencyResizeObservers.set(ownerWindow, sharedObserver);
	return sharedObserver;
};

const observeRootResizeTarget = (subscriber: VirtualListViewportSubscriber): void => {
	const sharedObserver = getSharedRootResizeObserver(subscriber.ownerWindow);
	observeSharedResizeTarget(sharedObserver, subscriber.rootEl, subscriber);
};

const unobserveRootResizeTarget = (subscriber: VirtualListViewportSubscriber): void => {
	const ownerWindow = subscriber.ownerWindow;
	const sharedObserver = sharedRootResizeObservers.get(ownerWindow) ?? null;
	unobserveSharedResizeTarget(sharedObserver, subscriber.rootEl, subscriber, () => {
		sharedRootResizeObservers.delete(ownerWindow);
	});
};

const observeLayoutDependencyTarget = (
	entry: ScrollerViewportEntry,
	target: HTMLElement,
): void => {
	const sharedObserver = getSharedLayoutDependencyResizeObserver(entry.ownerWindow);
	observeSharedResizeTarget(sharedObserver, target, entry);
};

const unobserveLayoutDependencyTarget = (
	entry: ScrollerViewportEntry,
	target: HTMLElement,
): void => {
	const ownerWindow = entry.ownerWindow;
	const sharedObserver =
		sharedLayoutDependencyResizeObservers.get(ownerWindow) ?? null;
	unobserveSharedResizeTarget(sharedObserver, target, entry, () => {
		sharedLayoutDependencyResizeObservers.delete(ownerWindow);
	});
};

const unobservePositionDependencyTargets = (entry: ScrollerViewportEntry): void => {
	for (const element of entry.positionDependencyElements) {
		unobserveLayoutDependencyTarget(entry, element);
	}
	entry.positionDependencyElements.clear();
};

const observeDependencyTargets = (entry: ScrollerViewportEntry): void => {
	const nextPosition = new Set<HTMLElement>();
	const nextStructure = new Set<Node>();
	const subscriber = getActiveSubscriber(entry);

	if (subscriber) {
		for (const element of collectPositionDependencyElements(
			subscriber.rootEl,
			entry.scroller,
		)) {
			nextPosition.add(element);
		}

		for (const target of collectStructureDependencyTargets(
			subscriber.rootEl,
			entry.scroller,
		)) {
			nextStructure.add(target);
		}
	}

	// Position dependencies: per-target diff
	for (const element of entry.positionDependencyElements) {
		if (!nextPosition.has(element)) {
			unobserveLayoutDependencyTarget(entry, element);
		}
	}
	for (const element of nextPosition) {
		if (!entry.positionDependencyElements.has(element)) {
			observeLayoutDependencyTarget(entry, element);
		}
	}
	entry.positionDependencyElements = nextPosition;

	// Structure dependencies: full reconnect only when changed
	let structureChanged = entry.structureDependencyTargets.size !== nextStructure.size;
	if (!structureChanged) {
		for (const target of entry.structureDependencyTargets) {
			if (!nextStructure.has(target)) {
				structureChanged = true;
				break;
			}
		}
	}

	if (structureChanged) {
		disconnectStructureObserver(entry);
		entry.structureDependencyTargets = nextStructure;
		if (!entry.isScrolling) {
			connectStructureObserver(entry);
		}
	}
};

const moveSubscriberToCurrentScroller = (
	subscriber: VirtualListViewportSubscriber,
): boolean => {
	const nextScroller = findNearestScrollContainerCached(subscriber.rootEl);
	if (nextScroller === subscriber.entry.scroller) {
		return false;
	}

	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	if (!ownerWindow) {
		return false;
	}
	invalidateNearestScrollContainerCache(subscriber.rootEl);
	unregisterSubscriber(subscriber);
	subscriber.ownerWindow = ownerWindow;
	const nextEntry = getScrollerViewportEntry(
		nextScroller,
		subscriber.rootEl,
		ownerWindow,
	);
	registerSubscriber(nextEntry, subscriber);
	subscriber.onScrollContainerChange(nextScroller);
	return true;
};

const refreshDependencyObservers = (entry: ScrollerViewportEntry): void => {
	const layoutMeasurementPending = entry.layoutMeasurementPendingForDependencyRefresh;
	entry.layoutMeasurementPendingForDependencyRefresh = false;

	const subscriber = getActiveSubscriber(entry);
	if (subscriber) {
		const moved = moveSubscriberToCurrentScroller(subscriber);
		if (moved && !layoutMeasurementPending) {
			scheduleLayoutMeasurement(subscriber.entry);
		}
	}

	if (getActiveSubscriber(entry)) {
		observeDependencyTargets(entry);
	}
};

const handleRootResizeEntry = (
	subscriber: VirtualListViewportSubscriber,
	contentRect: DOMRectReadOnly,
): void => {
	if (subscriber.isDisposed) {
		return;
	}

	invalidateNearestScrollContainerCache(subscriber.rootEl);
	const moved = moveSubscriberToCurrentScroller(subscriber);
	if (subscriber.isDisposed) {
		return;
	}

	const { width, height } = contentRect;
	const widthChanged =
		subscriber.lastObservedWidth === null ||
		Math.abs(width - subscriber.lastObservedWidth) >= ROOT_RESIZE_EPSILON_PX;
	const heightChanged =
		subscriber.lastObservedHeight === null ||
		Math.abs(height - subscriber.lastObservedHeight) >= ROOT_RESIZE_EPSILON_PX;
	if (!widthChanged && !heightChanged) {
		if (moved) {
			subscriber.scheduleLayoutMeasurement();
		}
		return;
	}

	subscriber.lastObservedWidth = width;
	subscriber.lastObservedHeight = height;
	if (widthChanged) {
		subscriber.onWidthChange(width);
		subscriber.scheduleLayoutMeasurement();
		return;
	}

	if (heightChanged) {
		if (subscriber.measureOnRootHeightChange === false) {
			if (moved) {
				subscriber.scheduleLayoutMeasurement();
			}
			return;
		}
		subscriber.scheduleLayoutMeasurement();
		return;
	}
};

const startScroll = (entry: ScrollerViewportEntry): void => {
	if (entry.isScrolling) {
		return;
	}

	entry.isScrolling = true;
	entry.reconnectStructureObserverAfterScroll = false;
	entry.refreshDependenciesAfterScroll = false;
	entry.measureLayoutAfterScroll = false;
	markScrollActivityActive(entry.scrollActivitySource);
	disconnectStructureObserver(entry);

	const subscriber = getActiveSubscriber(entry);
	subscriber?.cancelInitialStabilizationMeasurement?.();
	subscriber?.onScrollStart?.();
	notifyScrollStateChange(entry);
};

const finishScrollPhase = (entry: ScrollerViewportEntry): void => {
	if (!entry.isScrolling) {
		return;
	}

	const refreshDependencies = entry.refreshDependenciesAfterScroll;
	const measureLayout = entry.measureLayoutAfterScroll;
	const reconnectObserver = entry.reconnectStructureObserverAfterScroll;
	entry.isScrolling = false;
	entry.reconnectStructureObserverAfterScroll = false;
	entry.refreshDependenciesAfterScroll = false;
	entry.measureLayoutAfterScroll = false;

	markScrollActivityIdle(entry.scrollActivitySource);
	if (refreshDependencies) {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualList.observer.dependencyTask.scheduled");
		}
		scheduleDependencyObserverRefresh(entry);
	} else if (reconnectObserver) {
		// The scroll ended without any observed structure mutation, so re-arm
		// the existing targets instead of re-collecting dependencies.
		connectStructureObserver(entry);
	}
	if (measureLayout) {
		scheduleLayoutMeasurement(entry);
	} else {
		scheduleScrollMeasurement(entry, "scroll-idle");
	}
	notifyScrollStateChange(entry);
};

const finishScrollIdle = (entry: ScrollerViewportEntry): void => {
	if (!entry.isScrolling) {
		return;
	}

	if (entry.idleTimer !== null) {
		entry.ownerWindow.clearTimeout(entry.idleTimer);
	}
	entry.idleTimer = null;
	entry.pendingScrollTop = null;
	finishScrollPhase(entry);
};

// The idle timer is the single source of truth for idle detection. Native
// `scrollend` fires per programmatic scrollTop mutation, which would split a
// continuous rAF-driven scroll stream into per-frame gestures and schedule one
// idle measurement per scroll event, defeating the coverage gate.
//
// Keep one timer alive during a scroll stream. Scroll events only move the
// deadline; the timer reschedules itself when it observes a newer event.
const checkScrollIdle = (entry: ScrollerViewportEntry, ownerWindow: Window): void => {
	entry.idleTimer = null;
	const elapsed = readMonotonicTime(ownerWindow) - entry.lastScrollEventAt;
	const remaining = SCROLL_IDLE_MS - elapsed;
	if (remaining > 0) {
		entry.idleTimer = ownerWindow.setTimeout(entry.onScrollIdleTimeout, remaining);
		return;
	}

	finishScrollIdle(entry);
};

const handleNativeScroll = (
	entry: ScrollerViewportEntry,
	ownerWindow: Window,
): void => {
	entry.lastScrollEventAt = readMonotonicTime(ownerWindow);
	const scrollTop = readScrollTop(entry.scrollTarget);

	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("virtualList.observer.scrollEvent");
	}
	if (!entry.isScrolling) {
		startScroll(entry);
	}
	entry.pendingScrollTop = scrollTop;
	entry.scrollGeneration += 1;
	if (entry.idleTimer === null) {
		entry.idleTimer = ownerWindow.setTimeout(
			entry.onScrollIdleTimeout,
			SCROLL_IDLE_MS,
		);
	}

	entry.reconnectStructureObserverAfterScroll = true;

	// The pending task consumes the latest pendingScrollTop, so no additional
	// coverage decision is needed until that task runs.
	if (entry.hasPendingScrollMeasurement) {
		return;
	}

	if (isWithinScrollMeasurementRange(entry, scrollTop)) {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("virtualList.observer.coverageHit");
		}
		return;
	}

	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("virtualList.observer.coverageMiss");
		markCCLDevPerformance("ccl:coverage-miss");
	}
	scheduleScrollMeasurement(entry);
};

const handleStructureMutations = (
	entry: ScrollerViewportEntry,
	mutations: MutationRecord[],
): void => {
	let anyRelevant = false;
	for (const mutation of mutations) {
		if (mutation.type === "childList" && hasRelevantStructureMutation(mutation)) {
			anyRelevant = true;
			break;
		}
	}
	if (!anyRelevant) {
		return;
	}

	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) {
		return;
	}

	invalidateNearestScrollContainerCache(subscriber.rootEl);
	const shouldScheduleLayoutMeasurement =
		!entry.layoutMeasurementPendingForDependencyRefresh;
	entry.layoutMeasurementPendingForDependencyRefresh = true;

	if (entry.isScrolling) {
		entry.refreshDependenciesAfterScroll = true;
		entry.measureLayoutAfterScroll = true;
		return;
	}

	scheduleDependencyObserverRefresh(entry);
	if (shouldScheduleLayoutMeasurement) {
		scheduleLayoutMeasurement(entry);
	}
};

const getScrollerViewportEntry = (
	scroller: HTMLElement | null,
	fallbackKey: HTMLElement,
	ownerWindow: Window,
): ScrollerViewportEntry => {
	const key = scroller ?? fallbackKey;
	const existingEntry = scrollerViewportEntries.get(key);
	if (existingEntry) {
		return existingEntry;
	}
	const entry: ScrollerViewportEntry = {
		registryKey: key,
		scroller,
		ownerWindow,
		structureMutationObserver: undefined as unknown as MutationObserver,
		subscriber: null,
		hasPendingScrollMeasurement: false,
		scrollMeasurementReason: "scroll-coverage-miss",
		structureDependencyTargets: new Set<Node>(),
		positionDependencyElements: new Set<HTMLElement>(),
		scrollActivitySource: {},
		sharedScrollMetricsScratch: {
			scrollTop: 0,
			viewportHeight: 0,
			frameId: 0,
			isScrollActive: false,
			scrollGeneration: 0,
		},
		pendingScrollTop: null,
		scrollGeneration: 0,
		scrollCoverageGate: {
			valid: false,
			min: 0,
			max: 0,
		},
		scrollTarget: scroller ?? ownerWindow,
		isScrolling: false,
		reconnectStructureObserverAfterScroll: false,
		refreshDependenciesAfterScroll: false,
		measureLayoutAfterScroll: false,
		layoutMeasurementPendingForDependencyRefresh: false,
		structureObserverConnected: false,
		idleTimer: null,
		lastScrollEventAt: 0,
		onNativeScroll: undefined as unknown as () => void,
		onScrollIdleTimeout: undefined as unknown as () => void,
		unsubscribeWindowResize: null,
		runDependencyObserverRefresh,
	};

	function runDependencyObserverRefresh(): void {
		refreshDependencyObservers(entry);
	}

	const MutationObserverCtor = getMutationObserverConstructor(ownerWindow);
	entry.structureMutationObserver = new MutationObserverCtor(
		(mutations: MutationRecord[]) => {
			handleStructureMutations(entry, mutations);
		},
	);
	entry.onNativeScroll = () => handleNativeScroll(entry, ownerWindow);
	entry.onScrollIdleTimeout = () => checkScrollIdle(entry, ownerWindow);
	entry.scrollTarget.addEventListener("scroll", entry.onNativeScroll, {
		passive: true,
	});
	entry.unsubscribeWindowResize = subscribeWindowResize(() => {
		scheduleLayoutMeasurementWhenIdle(entry);
	}, ownerWindow);

	if (scroller) {
		observeLayoutDependencyTarget(entry, scroller);
	}

	scrollerViewportEntries.set(key, entry);
	return entry;
};

const registerSubscriber = (
	entry: ScrollerViewportEntry,
	subscriber: VirtualListViewportSubscriber,
): void => {
	const existing = entry.subscriber;
	if (existing && existing !== subscriber) {
		cancelDependencyObserverRefresh(existing);
		existing.isDisposed = true;
		entry.scrollCoverageGate.valid = false;
		entry.hasPendingScrollMeasurement = false;
		entry.pendingScrollTop = null;
		unobserveRootResizeTarget(existing);
		invalidateNearestScrollContainerCache(existing.rootEl);
	}

	subscriber.entry = entry;
	entry.subscriber = subscriber;
	observeRootResizeTarget(subscriber);
	observeDependencyTargets(entry);
	notifyScrollStateChange(entry);
};

const unregisterSubscriber = (subscriber: VirtualListViewportSubscriber): void => {
	const { entry } = subscriber;
	unobserveRootResizeTarget(subscriber);

	if (entry.subscriber !== subscriber) {
		return;
	}

	entry.subscriber = null;
	unobservePositionDependencyTargets(entry);
	if (entry.scroller) {
		unobserveLayoutDependencyTarget(entry, entry.scroller);
	}
	disconnectStructureObserver(entry);
	markScrollActivityIdle(entry.scrollActivitySource);
	cancelDependencyObserverRefresh(subscriber);
	if (entry.idleTimer !== null) {
		entry.ownerWindow.clearTimeout(entry.idleTimer);
		entry.idleTimer = null;
	}
	entry.hasPendingScrollMeasurement = false;
	entry.pendingScrollTop = null;
	entry.scrollCoverageGate.valid = false;
	entry.scrollTarget.removeEventListener("scroll", entry.onNativeScroll);
	entry.unsubscribeWindowResize?.();
	entry.unsubscribeWindowResize = null;
	scrollerViewportEntries.delete(entry.registryKey);
};

export const observeVirtualListViewport = (
	options: ObserveVirtualListViewportOptions,
): VirtualListViewportObservation => {
	let disposed = false;
	let currentSubscriber: VirtualListViewportSubscriber | null = null;
	let publishedRange = options.getScrollMeasurementRange?.() ?? null;

	const unbindCurrentRealm = (): void => {
		const subscriber = currentSubscriber;
		if (!subscriber) return;
		currentSubscriber = null;
		subscriber.isDisposed = true;
		unregisterSubscriber(subscriber);
		invalidateNearestScrollContainerCache(subscriber.rootEl);
	};

	const bindCurrentRealm = (): void => {
		if (disposed) return;
		const ownerWindow = getOptionalOwnerWindow(options.rootEl);
		if (!ownerWindow) {
			options.onScrollContainerChange(null);
			return;
		}

		const scrollContainer = findNearestScrollContainerCached(options.rootEl);
		const entry = getScrollerViewportEntry(
			scrollContainer,
			options.rootEl,
			ownerWindow,
		);
		const subscriber: VirtualListViewportSubscriber = {
			...options,
			ownerWindow,
			entry,
			lastObservedWidth: null,
			lastObservedHeight: null,
			isDisposed: false,
		};
		currentSubscriber = subscriber;

		options.onScrollContainerChange(scrollContainer);
		registerSubscriber(entry, subscriber);
		options.runInitialLayoutMeasurement();
		publishScrollMeasurementRange(entry, publishedRange);

		// Popout/window migration can bind while the composed ancestor tree is
		// still being attached. Only the premature `null` resolution needs a
		// retry on the next frame; when an element scroller was found, binding
		// is authoritative and the bind path must stay free of extra layout
		// reads (see the scroll-path contract in VirtualListDomObserver tests).
		if (scrollContainer === null) {
			invalidateNearestScrollContainerCache(options.rootEl);
			scheduleDependencyObserverRefresh(entry);
		}
	};

	const unregisterWindowMigration =
		typeof options.rootEl.onWindowMigrated === "function"
			? options.rootEl.onWindowMigrated(() => {
					unbindCurrentRealm();
					bindCurrentRealm();
				})
			: null;

	bindCurrentRealm();

	const observation = (() => {
		if (disposed) return;
		disposed = true;
		unregisterWindowMigration?.();
		unbindCurrentRealm();
	}) as VirtualListViewportObservation;

	observation.publishScrollMeasurementRange = (
		range: ScrollMeasurementRange | null,
	): void => {
		publishedRange = range;
		const subscriber = currentSubscriber;
		if (!subscriber || subscriber.isDisposed) return;
		if (subscriber.entry.subscriber !== subscriber) return;
		publishScrollMeasurementRange(subscriber.entry, range);
	};

	return observation;
};
