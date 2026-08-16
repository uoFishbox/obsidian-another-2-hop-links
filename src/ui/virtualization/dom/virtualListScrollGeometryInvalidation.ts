import { invalidateNearestScrollContainerCache } from "./scrollContainer";

export type ScrollGeometryInvalidationReason =
	| "root-resize"
	| "structure-mutation"
	| "subscriber-cleanup"
	| "scroller-changed"
	| "navigation-scroll"
	| "window-migration"
	| "observer-bind";

type VirtualListDebugCounterName = "scrollGeometryInvalidation";

const virtualListDebugCounters = new Map<string, number>();

export function recordVirtualListDebugCounter(
	name: VirtualListDebugCounterName,
	reason: ScrollGeometryInvalidationReason,
): void {
	const key = `${name}:${reason}`;
	virtualListDebugCounters.set(key, (virtualListDebugCounters.get(key) ?? 0) + 1);
}

export function invalidateScrollGeometry(
	rootEl: HTMLElement | null,
	reason: ScrollGeometryInvalidationReason,
): void {
	invalidateNearestScrollContainerCache(rootEl);
	recordVirtualListDebugCounter("scrollGeometryInvalidation", reason);
}
