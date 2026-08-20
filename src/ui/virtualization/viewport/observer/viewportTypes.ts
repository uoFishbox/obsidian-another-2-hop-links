import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import type { VirtualScrollMeasurementReason } from "../../runtime/measurementTypes";
import type { VirtualListSharedScrollMetrics } from "../sharedScrollMetrics";
import type { ScrollCoverageGate, ScrollMeasurementRange } from "./scrollCoverageGate";

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
