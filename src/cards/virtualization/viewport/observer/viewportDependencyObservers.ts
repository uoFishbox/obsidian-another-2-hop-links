import {
	collectPositionDependencyElements,
	collectStructureDependencyTargets,
	hasRelevantStructureMutation,
} from "./observerDependencies";
import {
	getActiveSubscriber,
	scheduleDependencyObserverRefresh,
	scheduleLayoutMeasurement,
	type ScrollerViewportEntry,
	type VirtualViewportSubscriber,
} from "./scrollMeasurement";
import type { VirtualViewportResizeObservers } from "./sharedViewportResizeObservers";

type WindowWithMutationObserver = Window & {
	MutationObserver?: typeof MutationObserver;
};

export interface ViewportDependencyObserverRuntimeOptions {
	readonly resizeObservers: VirtualViewportResizeObservers;
	moveSubscriberToCurrentScroller(subscriber: VirtualViewportSubscriber): boolean;
}

export interface ViewportDependencyObserverRuntime {
	createStructureObserver(
		ownerWindow: Window,
		onMutations: (mutations: MutationRecord[]) => void,
	): MutationObserver;
	observeTargets(entry: ScrollerViewportEntry): void;
	refresh(entry: ScrollerViewportEntry): void;
	handleStructureMutations(
		entry: ScrollerViewportEntry,
		mutations: readonly MutationRecord[],
	): void;
	clear(entry: ScrollerViewportEntry): void;
}

/** Owns position and structure dependency observation for viewport entries. */
export function createViewportDependencyObserverRuntime(
	options: ViewportDependencyObserverRuntimeOptions,
): ViewportDependencyObserverRuntime {
	function createStructureObserver(
		ownerWindow: Window,
		onMutations: (mutations: MutationRecord[]) => void,
	): MutationObserver {
		const MutationObserverCtor =
			(ownerWindow as WindowWithMutationObserver).MutationObserver ??
			MutationObserver;
		return new MutationObserverCtor(onMutations);
	}

	function disconnectStructureObserver(entry: ScrollerViewportEntry): void {
		if (!entry.structureObserverConnected) return;
		entry.structureMutationObserver.disconnect();
		entry.structureObserverConnected = false;
	}

	function connectStructureObserver(entry: ScrollerViewportEntry): void {
		if (entry.structureObserverConnected) return;
		for (const target of entry.structureDependencyTargets) {
			entry.structureMutationObserver.observe(target, { childList: true });
		}
		entry.structureObserverConnected = true;
	}

	function unobservePositionTargets(entry: ScrollerViewportEntry): void {
		for (const element of entry.positionDependencyElements) {
			options.resizeObservers.unobserveLayoutDependency(entry, element);
		}
		entry.positionDependencyElements.clear();
	}

	function observeTargets(entry: ScrollerViewportEntry): void {
		const nextPositionTargets = new Set<HTMLElement>();
		const nextStructureTargets = new Set<Node>();
		const subscriber = getActiveSubscriber(entry);

		if (subscriber) {
			for (const element of collectPositionDependencyElements(
				subscriber.rootEl,
				entry.scroller,
			)) {
				nextPositionTargets.add(element);
			}
			for (const target of collectStructureDependencyTargets(
				subscriber.rootEl,
				entry.scroller,
			)) {
				nextStructureTargets.add(target);
			}
		}

		for (const element of entry.positionDependencyElements) {
			if (!nextPositionTargets.has(element)) {
				options.resizeObservers.unobserveLayoutDependency(entry, element);
			}
		}
		for (const element of nextPositionTargets) {
			if (!entry.positionDependencyElements.has(element)) {
				options.resizeObservers.observeLayoutDependency(entry, element);
			}
		}
		entry.positionDependencyElements = nextPositionTargets;

		let structureTargetsChanged =
			entry.structureDependencyTargets.size !== nextStructureTargets.size;
		if (!structureTargetsChanged) {
			for (const target of entry.structureDependencyTargets) {
				if (!nextStructureTargets.has(target)) {
					structureTargetsChanged = true;
					break;
				}
			}
		}
		if (!structureTargetsChanged) return;

		disconnectStructureObserver(entry);
		entry.structureDependencyTargets = nextStructureTargets;
		connectStructureObserver(entry);
	}

	function refresh(entry: ScrollerViewportEntry): void {
		const layoutMeasurementPending =
			entry.layoutMeasurementPendingForDependencyRefresh;
		entry.layoutMeasurementPendingForDependencyRefresh = false;

		const subscriber = getActiveSubscriber(entry);
		if (subscriber) {
			const moved = options.moveSubscriberToCurrentScroller(subscriber);
			if (moved && !layoutMeasurementPending) {
				scheduleLayoutMeasurement(subscriber.entry);
			}
		}
		if (getActiveSubscriber(entry)) observeTargets(entry);
	}

	function handleStructureMutations(
		entry: ScrollerViewportEntry,
		mutations: readonly MutationRecord[],
	): void {
		const hasRelevantMutation = mutations.some(
			(mutation) =>
				mutation.type === "childList" && hasRelevantStructureMutation(mutation),
		);
		if (!hasRelevantMutation || !getActiveSubscriber(entry)) return;

		const shouldScheduleLayoutMeasurement =
			!entry.layoutMeasurementPendingForDependencyRefresh;
		entry.layoutMeasurementPendingForDependencyRefresh = true;
		if (entry.isScrolling) {
			entry.refreshDependenciesAfterScroll = true;
			entry.measureLayoutAfterScroll = true;
			return;
		}

		scheduleDependencyObserverRefresh(entry);
		if (shouldScheduleLayoutMeasurement) scheduleLayoutMeasurement(entry);
	}

	function clear(entry: ScrollerViewportEntry): void {
		unobservePositionTargets(entry);
		disconnectStructureObserver(entry);
	}

	return {
		createStructureObserver,
		observeTargets,
		refresh,
		handleStructureMutations,
		clear,
	};
}
