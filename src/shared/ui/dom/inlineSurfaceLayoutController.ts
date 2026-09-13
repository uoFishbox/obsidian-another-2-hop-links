import type { ActiveInlineContainer } from "./domUtils";
import { isHTMLElementLike } from "./realmSafeDom";

const INLINE_SURFACE_TOP_PROPERTY = "--ccl-inline-surface-top";

/** Dispatched on the scroller after its inline surface position changes. */
export const INLINE_SURFACE_POSITION_CHANGED = "ccl-inline-surface-position-changed";
const positionRefreshers = new WeakMap<HTMLElement, () => void>();

/** Refreshes placement before measuring, without scheduling another measurement. */
export function refreshInlineSurfacePosition(scroller: HTMLElement | null): void {
	if (scroller) positionRefreshers.get(scroller)?.();
}

export interface InlineSurfaceLayoutController {
	/** Stops observing the sizer and removes controller-owned inline styles. */
	dispose: () => void;
}

/**
 * Keeps an editor-inline card surface immediately below CodeMirror's sizer
 * without placing the surface in the scroller's normal layout flow.
 */
export function createInlineSurfaceLayoutController(
	target: ActiveInlineContainer,
): InlineSurfaceLayoutController {
	if (target.surface !== "source") {
		return createInactiveController();
	}

	const scroller = target.container.parentElement;
	if (!scroller?.classList.contains("cm-scroller")) {
		return createInactiveController();
	}

	const sizer = findDirectSizer(scroller);
	if (!sizer) {
		return createInactiveController();
	}

	let observer: ResizeObserver | null = null;
	let disposed = false;
	const refreshPosition = (): void => {
		updateInlineSurfacePosition(sizer, target.container);
	};
	positionRefreshers.set(scroller, refreshPosition);

	const bindObserverToCurrentWindow = (): void => {
		observer?.disconnect();
		observer = null;
		if (disposed) return;

		updateInlineSurfacePosition(sizer, target.container);
		const ownerWindow = target.container.ownerDocument.defaultView;
		const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
		if (!ResizeObserverConstructor) return;

		observer = new ResizeObserverConstructor(() => {
			if (disposed || !updateInlineSurfacePosition(sizer, target.container))
				return;
			scroller.dispatchEvent(new Event(INLINE_SURFACE_POSITION_CHANGED));
		});
		observer.observe(sizer, { box: "border-box" });
	};

	bindObserverToCurrentWindow();
	const unregisterWindowMigration =
		typeof target.container.onWindowMigrated === "function"
			? target.container.onWindowMigrated(() => bindObserverToCurrentWindow())
			: () => {};

	return {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			if (positionRefreshers.get(scroller) === refreshPosition) {
				positionRefreshers.delete(scroller);
			}
			unregisterWindowMigration();
			observer?.disconnect();
			observer = null;
			clearInlineSurfacePosition(target.container);
		},
	};
}

function findDirectSizer(scroller: HTMLElement): HTMLElement | null {
	for (const child of Array.from(scroller.children)) {
		if (isHTMLElementLike(child) && child.classList.contains("cm-sizer")) {
			return child;
		}
	}

	return null;
}

function updateInlineSurfacePosition(
	sizer: HTMLElement,
	container: HTMLElement,
): boolean {
	const top = Math.ceil(sizer.offsetTop + sizer.offsetHeight);
	const serializedTop = String(top);
	if (container.dataset.inlineSurfaceTop === serializedTop) {
		return false;
	}

	container.dataset.inlineSurfaceTop = serializedTop;
	container.style.setProperty(INLINE_SURFACE_TOP_PROPERTY, `${top}px`);
	return true;
}

function clearInlineSurfacePosition(container: HTMLElement): void {
	delete container.dataset.inlineSurfaceTop;
	container.style.removeProperty(INLINE_SURFACE_TOP_PROPERTY);
}

function createInactiveController(): InlineSurfaceLayoutController {
	return { dispose: () => {} };
}
