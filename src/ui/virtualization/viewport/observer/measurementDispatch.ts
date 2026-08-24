import {
	readVirtualListSharedScrollMetricsInto,
	resolveCachedViewportHeight,
	type VirtualListSharedScrollMetrics,
} from "../sharedScrollMetrics";
import type { VirtualScrollMeasurementReason } from "../../runtime/measurementTypes";
import {
	isWithinScrollCoverageGate,
	publishScrollCoverageGate,
	type ScrollMeasurementRange,
} from "./scrollCoverageGate";
import type { ScrollerViewportEntry, VirtualViewportSubscriber } from "./viewportTypes";

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
