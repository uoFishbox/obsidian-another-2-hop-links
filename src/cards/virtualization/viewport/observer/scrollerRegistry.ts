import { findNearestScrollContainer } from "shared/ui/scroll/scrollContainer";
import { markScrollActivityIdle } from "shared/ui/scroll/scrollActivity";
import { subscribeWindowResize } from "shared/ui/scroll/windowResize";
import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";
import { createVirtualViewportResizeObservers } from "./sharedViewportResizeObservers";
import { createViewportDependencyObserverRuntime } from "./viewportDependencyObservers";
import {
	cancelDependencyObserverRefresh,
	checkVirtualScrollIdle,
	getActiveSubscriber,
	handleVirtualScrollEvent,
	isWithinScrollMeasurementRange,
	notifyScrollStateChange,
	publishScrollMeasurementRange,
	readSharedScrollMetrics,
	scheduleDependencyObserverRefresh,
	scheduleLayoutMeasurement,
	scheduleScrollMeasurement,
	type ObserveVirtualViewportOptions,
	type ScrollMeasurementRange,
	type ScrollerViewportEntry,
	type VirtualScrollSessionActions,
	type VirtualViewportObservation,
	type VirtualViewportSubscriber as VirtualListViewportSubscriber,
} from "./scrollMeasurement";

export type {
	ObserveVirtualViewportOptions,
	ScrollMeasurementRange,
	VirtualViewportObservation,
} from "./scrollMeasurement";

const ROOT_RESIZE_EPSILON_PX = 0.5;

const scrollerViewportEntries = new WeakMap<object, ScrollerViewportEntry>();

const scheduleLayoutMeasurementWhenIdle = (entry: ScrollerViewportEntry): void => {
	if (entry.isScrolling) {
		entry.measureLayoutAfterScroll = true;
		return;
	}

	scheduleLayoutMeasurement(entry);
};

const observeRootResizeTarget = (subscriber: VirtualListViewportSubscriber): void => {
	viewportResizeObservers.observeRoot(subscriber);
};

const unobserveRootResizeTarget = (subscriber: VirtualListViewportSubscriber): void => {
	viewportResizeObservers.unobserveRoot(subscriber);
};

const moveSubscriberToCurrentScroller = (
	subscriber: VirtualListViewportSubscriber,
): boolean => {
	const nextScroller = findNearestScrollContainer(subscriber.rootEl);
	if (nextScroller === subscriber.entry.scroller) {
		return false;
	}

	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	if (!ownerWindow) {
		return false;
	}
	unregisterSubscriber(subscriber);
	subscriber.ownerWindow = ownerWindow;
	const nextEntry = getScrollerViewportEntry(nextScroller, ownerWindow);
	registerSubscriber(nextEntry, subscriber);
	subscriber.onScrollContainerChange(nextScroller);
	return true;
};

const handleRootResizeEntry = (
	subscriber: VirtualListViewportSubscriber,
	contentRect: DOMRectReadOnly,
): void => {
	if (subscriber.isDisposed) {
		return;
	}

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

const viewportResizeObservers = createVirtualViewportResizeObservers({
	onRootResize: handleRootResizeEntry,
	onLayoutDependencyResize: scheduleLayoutMeasurementWhenIdle,
});

const dependencyObservers = createViewportDependencyObserverRuntime({
	resizeObservers: viewportResizeObservers,
	moveSubscriberToCurrentScroller,
});

const createScrollSessionActions = (
	entry: ScrollerViewportEntry,
): VirtualScrollSessionActions => ({
	cancelInitialStabilizationMeasurement: () => {
		getActiveSubscriber(entry)?.cancelInitialStabilizationMeasurement?.();
	},
	onScrollStart: () => {
		getActiveSubscriber(entry)?.onScrollStart?.();
	},
	notifyScrollStateChange: () => notifyScrollStateChange(entry),
	scheduleDependencyObserverRefresh: () => scheduleDependencyObserverRefresh(entry),
	scheduleLayoutMeasurement: () => scheduleLayoutMeasurement(entry),
	scheduleScrollMeasurement: (reason) => scheduleScrollMeasurement(entry, reason),
	isWithinScrollMeasurementRange: (scrollTop) =>
		isWithinScrollMeasurementRange(entry, scrollTop),
});

const getScrollerViewportEntry = (
	scroller: HTMLElement | null,
	ownerWindow: Window,
): ScrollerViewportEntry => {
	const key = scroller ?? ownerWindow;
	const existingEntry = scrollerViewportEntries.get(key);
	if (existingEntry) {
		return existingEntry;
	}
	const entry: ScrollerViewportEntry = {
		registryKey: key,
		scroller,
		ownerWindow,
		structureMutationObserver: dependencyObservers.createStructureObserver(
			ownerWindow,
			(mutations) =>
				dependencyObservers.handleStructureMutations(entry, mutations),
		),
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
		refreshDependenciesAfterScroll: false,
		measureLayoutAfterScroll: false,
		layoutMeasurementPendingForDependencyRefresh: false,
		structureObserverConnected: false,
		idleTimer: null,
		lastScrollEventAt: 0,
		suppressedNativeScrollTop: null,
		onNativeScroll: () => handleVirtualScrollEvent(entry, scrollSessionActions),
		onScrollIdleTimeout: () => checkVirtualScrollIdle(entry, scrollSessionActions),
		unsubscribeWindowResize: null,
		runDependencyObserverRefresh: () => dependencyObservers.refresh(entry),
	};
	const scrollSessionActions = createScrollSessionActions(entry);
	entry.scrollTarget.addEventListener("scroll", entry.onNativeScroll, {
		passive: true,
	});
	entry.unsubscribeWindowResize = subscribeWindowResize(() => {
		scheduleLayoutMeasurementWhenIdle(entry);
	}, ownerWindow);

	if (scroller) {
		viewportResizeObservers.observeLayoutDependency(entry, scroller);
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
		entry.suppressedNativeScrollTop = null;
		unobserveRootResizeTarget(existing);
	}

	subscriber.entry = entry;
	entry.subscriber = subscriber;
	observeRootResizeTarget(subscriber);
	dependencyObservers.observeTargets(entry);
	notifyScrollStateChange(entry);
};

const unregisterSubscriber = (subscriber: VirtualListViewportSubscriber): void => {
	const { entry } = subscriber;
	unobserveRootResizeTarget(subscriber);

	if (entry.subscriber !== subscriber) {
		return;
	}

	entry.subscriber = null;
	dependencyObservers.clear(entry);
	if (entry.scroller) {
		viewportResizeObservers.unobserveLayoutDependency(entry, entry.scroller);
	}
	markScrollActivityIdle(entry.scrollActivitySource);
	cancelDependencyObserverRefresh(subscriber);
	if (entry.idleTimer !== null) {
		entry.ownerWindow.clearTimeout(entry.idleTimer);
		entry.idleTimer = null;
	}
	entry.hasPendingScrollMeasurement = false;
	entry.pendingScrollTop = null;
	entry.suppressedNativeScrollTop = null;
	entry.scrollCoverageGate.valid = false;
	entry.scrollTarget.removeEventListener("scroll", entry.onNativeScroll);
	entry.unsubscribeWindowResize?.();
	entry.unsubscribeWindowResize = null;
	scrollerViewportEntries.delete(entry.registryKey);
};

export const observeVirtualViewport = (
	options: ObserveVirtualViewportOptions,
): VirtualViewportObservation => {
	let disposed = false;
	let currentSubscriber: VirtualListViewportSubscriber | null = null;
	let publishedRange = options.getScrollMeasurementRange?.() ?? null;

	const unbindCurrentRealm = (): void => {
		const subscriber = currentSubscriber;
		if (!subscriber) return;
		currentSubscriber = null;
		subscriber.isDisposed = true;
		unregisterSubscriber(subscriber);
	};

	const bindCurrentRealm = (): void => {
		if (disposed) return;
		const ownerWindow = getOptionalOwnerWindow(options.rootEl);
		if (!ownerWindow) {
			options.onScrollContainerChange(null);
			return;
		}

		const scrollContainer = findNearestScrollContainer(options.rootEl);
		const entry = getScrollerViewportEntry(scrollContainer, ownerWindow);
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
		options.resetMeasurementForObservation?.();
		options.runInitialLayoutMeasurement();
		publishScrollMeasurementRange(entry, publishedRange);

		// Popout/window migration can bind while the composed ancestor tree is
		// still being attached. Only the premature `null` resolution needs a
		// retry on the next frame; when an element scroller was found, binding
		// is authoritative and the bind path must stay free of extra layout
		// reads (see the scroll-path contract in VirtualListDomObserver tests).
		if (scrollContainer === null) {
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
	}) as VirtualViewportObservation;

	observation.publishScrollMeasurementRange = (
		range: ScrollMeasurementRange | null,
	): void => {
		publishedRange = range;
		const subscriber = currentSubscriber;
		if (!subscriber || subscriber.isDisposed) return;
		if (subscriber.entry.subscriber !== subscriber) return;
		publishScrollMeasurementRange(subscriber.entry, range);
	};

	observation.suppressNextNativeScroll = (scrollTop: number): void => {
		const subscriber = currentSubscriber;
		if (!subscriber || subscriber.isDisposed) return;
		if (subscriber.entry.subscriber !== subscriber) return;
		subscriber.entry.suppressedNativeScrollTop = scrollTop;
	};

	return observation;
};
