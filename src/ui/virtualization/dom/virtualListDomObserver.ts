import { findNearestScrollContainerCached } from "./scrollContainer";
import {
	markScrollActivityActive,
	markScrollActivityIdle,
} from "ui/virtualization/scheduling/scrollActivity";
import { subscribeWindowResize } from "ui/virtualization/scheduling/windowResizeListeners";
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
	readVirtualListSharedScrollMetricsInto,
	resolveCachedViewportHeight,
	type VirtualListSharedScrollMetrics,
} from "./sharedScrollMetrics";
import { hasRelevantStructureMutation } from "./structureMutationObserver";
import {
	INITIAL_SCROLLER_VIEWPORT_SCROLL_PHASE_STATE,
	markScrollerViewportDependencyRefreshAfterScroll,
	markScrollerViewportLayoutMeasurementAfterScroll,
	markScrollerViewportScrollObserved,
	reduceScrollerViewportPhase,
	type ScrollerViewportScrollPhaseState,
	type ScrollPhase,
	type ScrollPhaseEffect,
} from "./scrollerViewportScrollPhase";
import { invalidateScrollGeometry } from "./virtualListScrollGeometryInvalidation";
import { getOptionalOwnerWindow, isHTMLElementLike } from "ui/shared/dom/realmSafeDom";
import type { ScrollMeasurementRange } from "../core/scrollWindowGate";

export type { VirtualListSharedScrollMetrics } from "./sharedScrollMetrics";

export interface ObserveVirtualListViewportOptions {
	rootEl: HTMLElement;
	onWidthChange: (width: number) => void;
	getCachedViewportHeight?: () => number;
	/** Returns the current open interval that does not require measurement. */
	getScrollMeasurementRange?: () => ScrollMeasurementRange | null;
	onScrollContainerChange: (element: HTMLElement | null) => void;
	scheduleLayoutMeasurement: () => void;
	scheduleScrollMeasurement: () => void;
	runScrollMeasurement: (metrics?: VirtualListSharedScrollMetrics) => void;
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

const ROOT_RESIZE_EPSILON_PX = 0.5;
const SCROLL_IDLE_MS = 140;

interface VirtualListViewportSubscriber extends Omit<
	ObserveVirtualListViewportOptions,
	"rootEl"
> {
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
	sharedScrollMetricsScratch: VirtualListSharedScrollMetrics;
	coverageScrollTopMin: number;
	coverageScrollTopMax: number;
	pendingScrollTop: number | null;
	scrollGeneration: number;
	scrollTarget: Window | HTMLElement;
	scrollEndTarget: Document | HTMLElement | null;
	scrollPhaseState: ScrollerViewportScrollPhaseState;
	structureObserverConnected: boolean;
	idleTimer: number | null;
	onNativeScroll: () => void;
	onNativeScrollEnd: () => void;
	unsubscribeWindowResize: (() => void) | null;
	layoutMeasurementTask: ReturnType<typeof createScheduledVirtualListTask>;
	scrollMeasurementTask: ReturnType<typeof createScheduledVirtualListTask>;
	refreshDependencyObserversTask: ReturnType<typeof createScheduledVirtualListTask>;
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

const resolveScrollEndTarget = (
	target: Window | HTMLElement,
): Document | HTMLElement | null => {
	const eventTarget = "document" in target ? target.document : target;
	return "onscrollend" in eventTarget ? eventTarget : null;
};

const getActiveSubscriber = (
	entry: ScrollerViewportEntry,
): VirtualListViewportSubscriber | null => {
	const { subscriber } = entry;
	if (!subscriber || subscriber.isDisposed) {
		return null;
	}

	return subscriber;
};

const scheduleLayoutMeasurement = (entry: ScrollerViewportEntry): void => {
	const subscriber = getActiveSubscriber(entry);
	if (!subscriber) {
		return;
	}

	entry.hasPendingLayoutMeasurement = true;
	entry.coverageScrollTopMin = Number.NaN;
	entry.coverageScrollTopMax = Number.NaN;
	entry.layoutMeasurementTask.schedule();
};

const scheduleScrollMeasurement = (entry: ScrollerViewportEntry): void => {
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

const notifyScrollStateChange = (entry: ScrollerViewportEntry): void => {
	getActiveSubscriber(entry)?.onScrollStateChange?.(
		entry.scrollGeneration,
		entry.pendingScrollTop !== null,
		entry.scrollPhaseState.type === "scrolling",
	);
};

const refreshCachedScrollMeasurementRange = (entry: ScrollerViewportEntry): void => {
	const range = getActiveSubscriber(entry)?.getScrollMeasurementRange?.();
	entry.coverageScrollTopMin = range?.minScrollTopBeforeMeasurement ?? Number.NaN;
	entry.coverageScrollTopMax = range?.maxScrollTopBeforeMeasurement ?? Number.NaN;
};

const isWithinCachedScrollMeasurementRange = (
	entry: ScrollerViewportEntry,
	scrollTop: number,
): boolean =>
	scrollTop > entry.coverageScrollTopMin && scrollTop < entry.coverageScrollTopMax;

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
		out.isScrollActive = entry.scrollPhaseState.type === "scrolling";
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
		isScrollActive: entry.scrollPhaseState.type === "scrolling",
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
	if (entry.scrollPhaseState.type === "scrolling") {
		entry.scrollPhaseState = markScrollerViewportLayoutMeasurementAfterScroll(
			entry.scrollPhaseState,
		);
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
	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	if (!ownerWindow) {
		return;
	}

	const sharedObserver = getSharedRootResizeObserver(ownerWindow);
	observeSharedResizeTarget(sharedObserver, subscriber.rootEl, subscriber);
};

const unobserveRootResizeTarget = (subscriber: VirtualListViewportSubscriber): void => {
	const ownerWindow = getOptionalOwnerWindow(subscriber.rootEl);
	const sharedObserver = ownerWindow
		? (sharedRootResizeObservers.get(ownerWindow) ?? null)
		: null;
	unobserveSharedResizeTarget(sharedObserver, subscriber.rootEl, subscriber, () => {
		if (ownerWindow) {
			sharedRootResizeObservers.delete(ownerWindow);
		}
	});
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
		? (sharedLayoutDependencyResizeObservers.get(ownerWindow) ?? null)
		: null;
	unobserveSharedResizeTarget(sharedObserver, target, entry, () => {
		if (ownerWindow) {
			sharedLayoutDependencyResizeObservers.delete(ownerWindow);
		}
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
		if (entry.scrollPhaseState.type !== "scrolling") {
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
	invalidateScrollGeometry(subscriber.rootEl, "scroller-changed");
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

	invalidateScrollGeometry(subscriber.rootEl, "root-resize");
	moveSubscriberToCurrentScroller(subscriber);
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

const applyScrollPhaseEffect = (
	entry: ScrollerViewportEntry,
	effect: ScrollPhaseEffect,
): void => {
	switch (effect.type) {
		case "none":
			return;
		case "scroll-start": {
			markScrollActivityActive(entry.scrollActivitySource);
			disconnectStructureObserver(entry);

			const subscriber = getActiveSubscriber(entry);
			subscriber?.cancelInitialStabilizationMeasurement?.();
			subscriber?.onScrollStart?.();
			return;
		}
		case "scroll-frame":
			scheduleScrollMeasurement(entry);
			return;
		case "scroll-idle":
			markScrollActivityIdle(entry.scrollActivitySource);
			if (effect.refreshDependencies) {
				entry.refreshDependencyObserversTask.schedule();
			}
			if (effect.measureLayout) {
				scheduleLayoutMeasurement(entry);
			}
			if (effect.measureScroll) {
				scheduleScrollMeasurement(entry);
			}
			return;
		default: {
			const _exhaustive: never = effect;
			return _exhaustive;
		}
	}
};

const handleScrollPhase = (entry: ScrollerViewportEntry, phase: ScrollPhase): void => {
	const transition = reduceScrollerViewportPhase(entry.scrollPhaseState, phase);
	entry.scrollPhaseState = transition.state;
	applyScrollPhaseEffect(entry, transition.effect);
	notifyScrollStateChange(entry);
};

const finishNativeScroll = (entry: ScrollerViewportEntry): void => {
	if (entry.scrollPhaseState.type === "idle") {
		return;
	}

	const ownerWindow = getOptionalOwnerWindow(entry.registryKey);
	if (ownerWindow && entry.idleTimer !== null) {
		ownerWindow.clearTimeout(entry.idleTimer);
	}
	entry.idleTimer = null;
	entry.pendingScrollTop = null;
	handleScrollPhase(entry, "idle");
};

const restartScrollIdleDetection = (
	entry: ScrollerViewportEntry,
	ownerWindow: Window,
): void => {
	if (entry.scrollEndTarget !== null) {
		return;
	}
	if (entry.idleTimer !== null) {
		ownerWindow.clearTimeout(entry.idleTimer);
	}
	entry.idleTimer = ownerWindow.setTimeout(entry.onNativeScrollEnd, SCROLL_IDLE_MS);
};

const handleNativeScroll = (
	entry: ScrollerViewportEntry,
	ownerWindow: Window,
): void => {
	const scrollTop = readScrollTop(entry.scrollTarget);

	if (entry.scrollPhaseState.type === "idle") {
		handleScrollPhase(entry, "start");
	}
	entry.pendingScrollTop = scrollTop;
	entry.scrollGeneration += 1;
	restartScrollIdleDetection(entry, ownerWindow);

	if (
		entry.scrollPhaseState.type === "scrolling" &&
		!entry.scrollPhaseState.pendingAfterScroll.reconnectObserver
	) {
		entry.scrollPhaseState = markScrollerViewportScrollObserved(
			entry.scrollPhaseState,
		);
	}

	if (isWithinCachedScrollMeasurementRange(entry, scrollTop)) {
		return;
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

	invalidateScrollGeometry(subscriber.rootEl, "structure-mutation");
	entry.refreshDependencyObserversTask.schedule();

	if (entry.scrollPhaseState.type === "scrolling") {
		entry.scrollPhaseState = markScrollerViewportDependencyRefreshAfterScroll(
			markScrollerViewportLayoutMeasurementAfterScroll(entry.scrollPhaseState),
		);
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
		sharedScrollMetricsScratch: {
			scrollTop: 0,
			viewportHeight: 0,
			frameId: 0,
			isScrollActive: false,
			scrollGeneration: 0,
		},
		coverageScrollTopMin: Number.NaN,
		coverageScrollTopMax: Number.NaN,
		pendingScrollTop: null,
		scrollGeneration: 0,
		scrollTarget: scroller ?? ownerWindow,
		scrollEndTarget: null,
		scrollPhaseState: INITIAL_SCROLLER_VIEWPORT_SCROLL_PHASE_STATE,
		structureObserverConnected: false,
		idleTimer: null,
		onNativeScroll: undefined as unknown as () => void,
		onNativeScrollEnd: undefined as unknown as () => void,
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
	entry.layoutMeasurementTask = createScheduledVirtualListTask(
		() => {
			if (!entry.hasPendingLayoutMeasurement) {
				return;
			}

			entry.hasPendingLayoutMeasurement = false;
			getActiveSubscriber(entry)?.scheduleLayoutMeasurement();
		},
		() => getOptionalOwnerWindow(entry.registryKey),
	);
	entry.scrollMeasurementTask = createScheduledVirtualListTask(
		() => {
			if (!entry.hasPendingScrollMeasurement) {
				return;
			}

			entry.hasPendingScrollMeasurement = false;
			const subscriber = getActiveSubscriber(entry);
			if (!subscriber) {
				return;
			}
			subscriber.runScrollMeasurement(readSharedScrollMetrics(entry));
			refreshCachedScrollMeasurementRange(entry);
		},
		() => getOptionalOwnerWindow(entry.registryKey),
	);
	entry.scrollEndTarget = resolveScrollEndTarget(entry.scrollTarget);
	entry.onNativeScroll = () => handleNativeScroll(entry, ownerWindow);
	entry.onNativeScrollEnd = () => finishNativeScroll(entry);
	entry.scrollTarget.addEventListener("scroll", entry.onNativeScroll, {
		passive: true,
	});
	entry.scrollEndTarget?.addEventListener("scrollend", entry.onNativeScrollEnd, {
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
		existing.isDisposed = true;
		entry.hasPendingScrollMeasurement = false;
		entry.hasPendingLayoutMeasurement = false;
		entry.pendingScrollTop = null;
		unobserveRootResizeTarget(existing);
		invalidateScrollGeometry(existing.rootEl, "subscriber-cleanup");
	}

	subscriber.entry = entry;
	entry.subscriber = subscriber;
	observeRootResizeTarget(subscriber);
	observeDependencyTargets(entry);
	refreshCachedScrollMeasurementRange(entry);
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
	entry.refreshDependencyObserversTask.cancel();
	entry.layoutMeasurementTask.cancel();
	entry.scrollMeasurementTask.cancel();
	if (entry.idleTimer !== null) {
		const ownerWindow = getOptionalOwnerWindow(entry.registryKey);
		ownerWindow?.clearTimeout(entry.idleTimer);
		entry.idleTimer = null;
	}
	entry.hasPendingScrollMeasurement = false;
	entry.hasPendingLayoutMeasurement = false;
	entry.pendingScrollTop = null;
	entry.scrollTarget.removeEventListener("scroll", entry.onNativeScroll);
	entry.scrollEndTarget?.removeEventListener("scrollend", entry.onNativeScrollEnd);
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
	refreshCachedScrollMeasurementRange(entry);

	return () => {
		if (subscriber.isDisposed) {
			return;
		}

		subscriber.isDisposed = true;
		unregisterSubscriber(subscriber);
		invalidateScrollGeometry(subscriber.rootEl, "subscriber-cleanup");
	};
};
