import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";
import {
	observeSharedResizeTarget,
	unobserveSharedResizeTarget,
	type SharedResizeObserverRegistry,
} from "./observerDependencies";
import type {
	ScrollerViewportEntry,
	VirtualViewportSubscriber,
} from "./scrollMeasurement";

type SharedRootResizeObserver = SharedResizeObserverRegistry<VirtualViewportSubscriber>;

type SharedLayoutDependencyResizeObserver =
	SharedResizeObserverRegistry<ScrollerViewportEntry>;

type WindowWithResizeObserver = Window & {
	ResizeObserver?: typeof ResizeObserver;
};

export interface VirtualViewportResizeObserverHandlers {
	onRootResize(
		subscriber: VirtualViewportSubscriber,
		contentRect: DOMRectReadOnly,
	): void;
	onLayoutDependencyResize(entry: ScrollerViewportEntry): void;
}

export interface VirtualViewportResizeObservers {
	observeRoot(subscriber: VirtualViewportSubscriber): void;
	unobserveRoot(subscriber: VirtualViewportSubscriber): void;
	observeLayoutDependency(entry: ScrollerViewportEntry, target: HTMLElement): void;
	unobserveLayoutDependency(entry: ScrollerViewportEntry, target: HTMLElement): void;
}

/** Owns the Window-scoped ResizeObserver pools used by virtual viewports. */
export function createVirtualViewportResizeObservers(
	handlers: VirtualViewportResizeObserverHandlers,
): VirtualViewportResizeObservers {
	const rootObservers = new WeakMap<Window, SharedRootResizeObserver>();
	const layoutDependencyObservers = new WeakMap<
		Window,
		SharedLayoutDependencyResizeObserver
	>();

	function getResizeObserverConstructor(ownerWindow: Window): typeof ResizeObserver {
		return (
			(ownerWindow as WindowWithResizeObserver).ResizeObserver ?? ResizeObserver
		);
	}

	function getRootObserver(ownerWindow: Window): SharedRootResizeObserver {
		const existing = rootObservers.get(ownerWindow);
		if (existing) return existing;

		const ResizeObserverCtor = getResizeObserverConstructor(ownerWindow);
		const sharedObserver: SharedRootResizeObserver = {
			observer: new ResizeObserverCtor((entries: ResizeObserverEntry[]) => {
				for (const resizeEntry of entries) {
					if (!isHTMLElementLike(resizeEntry.target)) continue;
					const subscribers = sharedObserver.subscribersByTarget.get(
						resizeEntry.target,
					);
					if (!subscribers) continue;

					for (const subscriber of Array.from(subscribers)) {
						handlers.onRootResize(subscriber, resizeEntry.contentRect);
					}
				}
			}),
			subscribersByTarget: new Map<HTMLElement, Set<VirtualViewportSubscriber>>(),
		};
		rootObservers.set(ownerWindow, sharedObserver);
		return sharedObserver;
	}

	function getLayoutDependencyObserver(
		ownerWindow: Window,
	): SharedLayoutDependencyResizeObserver {
		const existing = layoutDependencyObservers.get(ownerWindow);
		if (existing) return existing;

		const ResizeObserverCtor = getResizeObserverConstructor(ownerWindow);
		const sharedObserver: SharedLayoutDependencyResizeObserver = {
			observer: new ResizeObserverCtor((entries: ResizeObserverEntry[]) => {
				const entriesToMeasure = new Set<ScrollerViewportEntry>();
				for (const resizeEntry of entries) {
					if (!isHTMLElementLike(resizeEntry.target)) continue;
					const scrollerEntries = sharedObserver.subscribersByTarget.get(
						resizeEntry.target,
					);
					if (!scrollerEntries) continue;
					for (const entry of scrollerEntries) entriesToMeasure.add(entry);
				}

				for (const entry of entriesToMeasure) {
					handlers.onLayoutDependencyResize(entry);
				}
			}),
			subscribersByTarget: new Map<HTMLElement, Set<ScrollerViewportEntry>>(),
		};
		layoutDependencyObservers.set(ownerWindow, sharedObserver);
		return sharedObserver;
	}

	function observeRoot(subscriber: VirtualViewportSubscriber): void {
		observeSharedResizeTarget(
			getRootObserver(subscriber.ownerWindow),
			subscriber.rootEl,
			subscriber,
		);
	}

	function unobserveRoot(subscriber: VirtualViewportSubscriber): void {
		const ownerWindow = subscriber.ownerWindow;
		unobserveSharedResizeTarget(
			rootObservers.get(ownerWindow) ?? null,
			subscriber.rootEl,
			subscriber,
			() => rootObservers.delete(ownerWindow),
		);
	}

	function observeLayoutDependency(
		entry: ScrollerViewportEntry,
		target: HTMLElement,
	): void {
		observeSharedResizeTarget(
			getLayoutDependencyObserver(entry.ownerWindow),
			target,
			entry,
		);
	}

	function unobserveLayoutDependency(
		entry: ScrollerViewportEntry,
		target: HTMLElement,
	): void {
		const ownerWindow = entry.ownerWindow;
		unobserveSharedResizeTarget(
			layoutDependencyObservers.get(ownerWindow) ?? null,
			target,
			entry,
			() => layoutDependencyObservers.delete(ownerWindow),
		);
	}

	return {
		observeRoot,
		unobserveRoot,
		observeLayoutDependency,
		unobserveLayoutDependency,
	};
}
