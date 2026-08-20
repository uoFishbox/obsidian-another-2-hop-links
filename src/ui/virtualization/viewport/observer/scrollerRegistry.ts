import {
	findNearestScrollContainerCached,
	invalidateNearestScrollContainerCache,
} from "ui/shared/scroll/scrollContainer";
import { markScrollActivityIdle } from "ui/shared/scroll/scrollActivity";
import { subscribeWindowResize } from "ui/shared/scroll/windowResize";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	collectPositionDependencyElements,
	collectStructureDependencyTargets,
} from "ui/virtualization/viewport/observer/layoutDependencies";
import {
	observeSharedResizeTarget,
	unobserveSharedResizeTarget,
	type SharedResizeObserverRegistry,
} from "./sharedResizeRegistry";
import { hasRelevantStructureMutation } from "./structureMutation";
import { getOptionalOwnerWindow, isHTMLElementLike } from "ui/shared/dom/realmSafeDom";
import {
	checkVirtualScrollIdle,
	handleVirtualScrollEvent,
	type VirtualScrollSessionActions,
} from "./scrollSession";
import type { ScrollMeasurementRange } from "./scrollCoverageGate";
import {
	cancelDependencyObserverRefresh,
	getActiveSubscriber,
	isWithinScrollMeasurementRange,
	notifyScrollStateChange,
	publishScrollMeasurementRange,
	readSharedScrollMetrics,
	scheduleDependencyObserverRefresh,
	scheduleLayoutMeasurement,
	scheduleScrollMeasurement,
} from "./measurementDispatch";
import type {
	ObserveVirtualViewportOptions,
	ScrollerViewportEntry,
	VirtualViewportObservation,
	VirtualViewportSubscriber as VirtualListViewportSubscriber,
} from "./viewportTypes";

export type { ScrollMeasurementRange } from "./scrollCoverageGate";
export type {
	ObserveVirtualViewportOptions,
	VirtualViewportObservation,
} from "./viewportTypes";

const ROOT_RESIZE_EPSILON_PX = 0.5;

const scrollerViewportEntries = new WeakMap<HTMLElement, ScrollerViewportEntry>();

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

const createScrollSessionActions = (
	entry: ScrollerViewportEntry,
): VirtualScrollSessionActions => ({
	disconnectStructureObserver: () => disconnectStructureObserver(entry),
	connectStructureObserver: () => connectStructureObserver(entry),
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
	const scrollSessionActions = createScrollSessionActions(entry);
	entry.onNativeScroll = () => handleVirtualScrollEvent(entry, scrollSessionActions);
	entry.onScrollIdleTimeout = () =>
		checkVirtualScrollIdle(entry, scrollSessionActions);
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

export const registerVirtualViewport = (
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

	return observation;
};
