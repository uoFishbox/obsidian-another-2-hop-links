import {
	findNearestScrollContainerCached,
	invalidateNearestScrollContainerCache,
} from "../../virtualGridLinkListScroll";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "infrastructure/scroll/scrollActivity";
import {
	subscribeScrollTarget,
	type ScrollPhase,
} from "infrastructure/scroll/scrollTargetListeners";
import { subscribeWindowResize } from "infrastructure/scroll/windowResizeListeners";
import { createScheduledVirtualListTask } from "./virtualListScheduler";
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
	readVirtualListSharedScrollMetrics,
	type VirtualListSharedScrollMetrics,
} from "./sharedScrollMetrics";
import { hasRelevantStructureMutation } from "./structureMutationObserver";
import { applyScrollerViewportScrollPhase } from "./scrollerViewportScrollPhase";
import {
	getOptionalOwnerWindow,
	isHTMLElementLike,
} from "ui/utils/realmSafeDom";

export type { VirtualListSharedScrollMetrics } from "./sharedScrollMetrics";

export interface ObserveVirtualListViewportOptions {
	rootEl: HTMLElement;
	onWidthChange: (width: number) => void;
	getCachedViewportHeight?: () => number;
	onScrollContainerChange: (element: HTMLElement | null) => void;
	scheduleLayoutMeasurement: () => void;
	scheduleScrollMeasurement: () => void;
	runScrollMeasurement: (metrics?: VirtualListSharedScrollMetrics) => void;
	runInitialLayoutMeasurement: () => void;
	cancelInitialStabilizationMeasurement?: () => void;
	/**
	 * Invoked once when a scroll gesture starts (scroll "start" phase). Used to
	 * prime layout measurement when scroll metrics are still unstable, so the
	 * first scroll frame does not fall back to repeated unstable retries.
	 */
	onScrollStart?: () => void;
}

const ROOT_RESIZE_EPSILON_PX = 0.5;

interface VirtualListViewportSubscriber
	extends
		Omit<ObserveVirtualListViewportOptions, "rootEl"> {
	rootEl: HTMLElement;
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
	structureMutationObserver: MutationObserver;
	subscriber: VirtualListViewportSubscriber | null;
	hasPendingScrollMeasurement: boolean;
	hasPendingLayoutMeasurement: boolean;
	structureDependencyTargets: Set<Node>;
	positionDependencyElements: Set<HTMLElement>;
	scrollActivitySource: object;
	scrollTarget: Window | HTMLElement;
	isScrollActive: boolean;
	structureObserverConnected: boolean;
	needsObserverReconnectAfterScroll: boolean;
	needsDependencyRefreshAfterScroll: boolean;
	needsLayoutMeasurementAfterScroll: boolean;
	becameActive: boolean;
	becameIdle: boolean;
	shouldRefreshDependencies: boolean;
	shouldMeasureLayout: boolean;
	shouldMeasureScroll: boolean;
	shouldReconnectObserver: boolean;
	unsubscribeScrollTarget: (() => void) | null;
	unsubscribeWindowResize: (() => void) | null;
	layoutMeasurementTask: ReturnType<typeof createScheduledVirtualListTask>;
	scrollMeasurementTask: ReturnType<typeof createScheduledVirtualListTask>;
	refreshDependencyObserversTask: ReturnType<
		typeof createScheduledVirtualListTask
	>;
}

const scrollerViewportEntries = new WeakMap<
	HTMLElement,
	ScrollerViewportEntry
>();
let scrollMeasurementFrameId = 0;

type SharedRootResizeObserver =
	SharedResizeObserverRegistry<VirtualListViewportSubscriber>;

type SharedLayoutDependencyResizeObserver =
	SharedResizeObserverRegistry<ScrollerViewportEntry>;

type WindowObserverConstructors = Window & {
	ResizeObserver?: typeof ResizeObserver;
	MutationObserver?: typeof MutationObserver;
};

const sharedRootResizeObservers = new WeakMap<
	Window,
	SharedRootResizeObserver
>();
const sharedLayoutDependencyResizeObservers = new WeakMap<
	Window,
	SharedLayoutDependencyResizeObserver
>();

const getResizeObserverConstructor = (
	ownerWindow: Window,
): typeof ResizeObserver =>
	(ownerWindow as WindowObserverConstructors).ResizeObserver ??
	ResizeObserver;

const getMutationObserverConstructor = (
	ownerWindow: Window,
): typeof MutationObserver =>
	(ownerWindow as WindowObserverConstructors).MutationObserver ??
	MutationObserver;

const getActiveSubscriber = (
	entry: ScrollerViewportEntry,
): VirtualListViewportSubscriber | null => {
	const { subscriber } = entry;
	if (!subscriber || subscriber.isDisposed) {
		return null;
	}

	return subscriber;
};

const scheduleLayoutMeasurement = (
	entry: ScrollerViewportEntry,
): void => {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) {
		return;
	}

	entry.hasPendingLayoutMeasurement = true;
	entry.layoutMeasurementTask.schedule();
};

const scheduleScrollMeasurement = (
	entry: ScrollerViewportEntry,
): void => {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) {
		return;
	}

	entry.hasPendingScrollMeasurement = true;
	if (entry.scrollMeasurementTask.isScheduled()) {
		return;
	}

	entry.scrollMeasurementTask.schedule();
};

const readSharedScrollMetrics = (
	entry: ScrollerViewportEntry,
): VirtualListSharedScrollMetrics => {
	const subscriber = getActiveSubscriber(entry);
	return readVirtualListSharedScrollMetrics({
		scroller: entry.scroller,
		subscriber,
		ownerElement: subscriber?.rootEl ?? entry.registryKey,
		frameId: ++scrollMeasurementFrameId,
		isScrollActive: entry.isScrollActive,
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

const scheduleLayoutMeasurementWhenIdle = (
	entry: ScrollerViewportEntry,
): void => {
	if (entry.isScrollActive) {
		entry.needsLayoutMeasurementAfterScroll = true;
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

const getSharedRootResizeObserver = (
	ownerWindow: Window,
): SharedRootResizeObserver => {
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
		subscribersByTarget: new Map<
			HTMLElement,
			Set<VirtualListViewportSubscriber>
		>(),
	};
	sharedRootResizeObservers.set(ownerWindow, sharedObserver);
	return sharedObserver;
};

const getSharedLayoutDependencyResizeObserver =
	(ownerWindow: Window): SharedLayoutDependencyResizeObserver => {
		const existing = sharedLayoutDependencyResizeObservers.get(ownerWindow);
		if (existing) {
			return existing;
		}

		const ResizeObserverCtor = getResizeObserverConstructor(ownerWindow);
		const sharedObserver: SharedLayoutDependencyResizeObserver = {
			observer: new ResizeObserverCtor(
				(entries: ResizeObserverEntry[]) => {
					scheduleLayoutMeasurementForResizeEntries(
						sharedObserver,
						entries,
					);
				},
			),
			subscribersByTarget: new Map<
				HTMLElement,
				Set<ScrollerViewportEntry>
			>(),
		};
		sharedLayoutDependencyResizeObservers.set(
			ownerWindow,
			sharedObserver,
		);
		return sharedObserver;
	};

const observeRootResizeTarget = (
	subscriber: VirtualListViewportSubscriber,
): void => {
	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	if (!ownerWindow) {
		return;
	}

	const sharedObserver = getSharedRootResizeObserver(ownerWindow);
	observeSharedResizeTarget(sharedObserver, subscriber.rootEl, subscriber);
};

const unobserveRootResizeTarget = (
	subscriber: VirtualListViewportSubscriber,
): void => {
	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	const sharedObserver = ownerWindow
		? sharedRootResizeObservers.get(ownerWindow) ?? null
		: null;
	unobserveSharedResizeTarget(
		sharedObserver,
		subscriber.rootEl,
		subscriber,
		() => {
			if (ownerWindow) {
				sharedRootResizeObservers.delete(ownerWindow);
			}
		},
	);
};

const observeLayoutDependencyTarget = (
	entry: ScrollerViewportEntry,
	target: HTMLElement,
): void => {
	const ownerWindow = getOptionalOwnerWindow(target);
	if (!ownerWindow) {
		return;
	}

	const sharedObserver = getSharedLayoutDependencyResizeObserver(ownerWindow);
	observeSharedResizeTarget(sharedObserver, target, entry);
};

const unobserveLayoutDependencyTarget = (
	entry: ScrollerViewportEntry,
	target: HTMLElement,
): void => {
	const ownerWindow = getOptionalOwnerWindow(target);
	const sharedObserver = ownerWindow
		? sharedLayoutDependencyResizeObservers.get(ownerWindow) ?? null
		: null;
	unobserveSharedResizeTarget(
		sharedObserver,
		target,
		entry,
		() => {
			if (ownerWindow) {
				sharedLayoutDependencyResizeObservers.delete(ownerWindow);
			}
		},
	);
};

const unobservePositionDependencyTargets = (
	entry: ScrollerViewportEntry,
): void => {
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
	let structureChanged =
		entry.structureDependencyTargets.size !== nextStructure.size;
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
		if (!entry.isScrollActive) {
			connectStructureObserver(entry);
		}
	}
};

const moveSubscriberToCurrentScroller = (
	subscriber: VirtualListViewportSubscriber,
): void => {
	const nextScroller = findNearestScrollContainerCached(subscriber.rootEl);
	if (nextScroller === subscriber.entry.scroller) {
		return;
	}

	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	if (!ownerWindow) {
		return;
	}
	unregisterSubscriber(subscriber);
	const nextEntry = getScrollerViewportEntry(
		nextScroller,
		subscriber.rootEl,
		ownerWindow,
	);
	registerSubscriber(nextEntry, subscriber);
	subscriber.onScrollContainerChange(nextScroller);
	subscriber.scheduleLayoutMeasurement();
};

const refreshDependencyObservers = (entry: ScrollerViewportEntry): void => {
	const subscriber = getActiveSubscriber(entry);
	if (subscriber) {
		moveSubscriberToCurrentScroller(subscriber);
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
	moveSubscriberToCurrentScroller(subscriber);
	if (subscriber.isDisposed) {
		return;
	}

	const { width, height } = contentRect;
	const widthChanged =
		subscriber.lastObservedWidth === null ||
		Math.abs(width - subscriber.lastObservedWidth) >=
			ROOT_RESIZE_EPSILON_PX;
	const heightChanged =
		subscriber.lastObservedHeight === null ||
		Math.abs(height - subscriber.lastObservedHeight) >=
			ROOT_RESIZE_EPSILON_PX;
	if (!widthChanged && !heightChanged) {
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
		subscriber.scheduleLayoutMeasurement();
		return;
	}
};

const handleScrollPhase = (
	entry: ScrollerViewportEntry,
	phase: ScrollPhase,
): void => {
	applyScrollerViewportScrollPhase(entry, phase);

	if (entry.becameActive) {
		markScrollActivityActive(entry.scrollActivitySource);
		disconnectStructureObserver(entry);

		getActiveSubscriber(entry)?.cancelInitialStabilizationMeasurement?.();
		getActiveSubscriber(entry)?.onScrollStart?.();
	}

	if (entry.becameIdle) {
		markScrollActivityIdle(entry.scrollActivitySource);
	}

	if (entry.shouldRefreshDependencies) {
		entry.refreshDependencyObserversTask.schedule();
	}

	if (entry.shouldMeasureLayout) {
		scheduleLayoutMeasurement(entry);
	}

	if (entry.shouldMeasureScroll) {
		scheduleScrollMeasurement(entry);
	}
};

const handleStructureMutations = (
	entry: ScrollerViewportEntry,
	mutations: MutationRecord[],
): void => {
	let anyRelevant = false;
	for (const mutation of mutations) {
		if (
			mutation.type === "childList" &&
			hasRelevantStructureMutation(mutation)
		) {
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
	entry.refreshDependencyObserversTask.schedule();

	if (entry.isScrollActive) {
		entry.needsLayoutMeasurementAfterScroll = true;
		entry.needsDependencyRefreshAfterScroll = true;
		return;
	}

	scheduleLayoutMeasurement(entry);
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
		structureMutationObserver: undefined as unknown as MutationObserver,
		subscriber: null,
		hasPendingScrollMeasurement: false,
		hasPendingLayoutMeasurement: false,
		structureDependencyTargets: new Set<Node>(),
		positionDependencyElements: new Set<HTMLElement>(),
		scrollActivitySource: {},
		scrollTarget: scroller ?? ownerWindow,
		isScrollActive: false,
		structureObserverConnected: false,
		needsObserverReconnectAfterScroll: false,
		needsDependencyRefreshAfterScroll: false,
		needsLayoutMeasurementAfterScroll: false,
		becameActive: false,
		becameIdle: false,
		shouldRefreshDependencies: false,
		shouldMeasureLayout: false,
		shouldMeasureScroll: false,
		shouldReconnectObserver: false,
		unsubscribeScrollTarget: null,
		unsubscribeWindowResize: null,
		layoutMeasurementTask: undefined as unknown as ReturnType<
			typeof createScheduledVirtualListTask
		>,
		scrollMeasurementTask: undefined as unknown as ReturnType<
			typeof createScheduledVirtualListTask
		>,
		refreshDependencyObserversTask: undefined as unknown as ReturnType<
			typeof createScheduledVirtualListTask
		>,
	};

	const MutationObserverCtor = getMutationObserverConstructor(ownerWindow);
	entry.structureMutationObserver = new MutationObserverCtor(
		(mutations: MutationRecord[]) => {
			handleStructureMutations(entry, mutations);
		},
	);
	entry.refreshDependencyObserversTask = createScheduledVirtualListTask(
		() => {
			refreshDependencyObservers(entry);
		},
		() => getOptionalOwnerWindow(entry.registryKey),
	);
	entry.layoutMeasurementTask = createScheduledVirtualListTask(() => {
		if (!entry.hasPendingLayoutMeasurement) {
			return;
		}

		entry.hasPendingLayoutMeasurement = false;
		getActiveSubscriber(entry)?.scheduleLayoutMeasurement();
	}, () => getOptionalOwnerWindow(entry.registryKey));
	entry.scrollMeasurementTask = createScheduledVirtualListTask(() => {
		if (!entry.hasPendingScrollMeasurement) {
			return;
		}

		entry.hasPendingScrollMeasurement = false;
		getActiveSubscriber(entry)?.runScrollMeasurement(
			readSharedScrollMetrics(entry),
		);
	}, () => getOptionalOwnerWindow(entry.registryKey));
	entry.unsubscribeScrollTarget = subscribeScrollTarget(
		entry.scrollTarget,
		(phase) => handleScrollPhase(entry, phase),
	);
	entry.unsubscribeWindowResize = subscribeWindowResize(
		() => {
			scheduleLayoutMeasurementWhenIdle(entry);
		},
		ownerWindow,
	);

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
		existing.isDisposed = true;
		entry.hasPendingScrollMeasurement = false;
		entry.hasPendingLayoutMeasurement = false;
		unobserveRootResizeTarget(existing);
		invalidateNearestScrollContainerCache(existing.rootEl);
	}

	subscriber.entry = entry;
	entry.subscriber = subscriber;
	observeRootResizeTarget(subscriber);
	observeDependencyTargets(entry);
};

const unregisterSubscriber = (
	subscriber: VirtualListViewportSubscriber,
): void => {
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
	entry.refreshDependencyObserversTask.cancel();
	entry.layoutMeasurementTask.cancel();
	entry.scrollMeasurementTask.cancel();
	entry.hasPendingScrollMeasurement = false;
	entry.hasPendingLayoutMeasurement = false;
	entry.unsubscribeScrollTarget?.();
	entry.unsubscribeScrollTarget = null;
	entry.unsubscribeWindowResize?.();
	entry.unsubscribeWindowResize = null;
	scrollerViewportEntries.delete(entry.registryKey);
};

export const observeVirtualListViewport = (
	options: ObserveVirtualListViewportOptions,
): (() => void) => {
	const ownerWindow = getOptionalOwnerWindow(options.rootEl);
	if (!ownerWindow) {
		return () => {};
	}

	const scrollContainer = findNearestScrollContainerCached(options.rootEl);
	const entry = getScrollerViewportEntry(
		scrollContainer,
		options.rootEl,
		ownerWindow,
	);
	const subscriber: VirtualListViewportSubscriber = {
		...options,
		entry,
		lastObservedWidth: null,
		lastObservedHeight: null,
		isDisposed: false,
	};

	options.onScrollContainerChange(scrollContainer);
	registerSubscriber(entry, subscriber);
	options.runInitialLayoutMeasurement();

	return () => {
		if (subscriber.isDisposed) {
			return;
		}

		subscriber.isDisposed = true;
		unregisterSubscriber(subscriber);
		invalidateNearestScrollContainerCache(subscriber.rootEl);
	};
};
