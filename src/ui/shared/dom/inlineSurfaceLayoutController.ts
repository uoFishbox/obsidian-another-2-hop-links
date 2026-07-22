import type { ActiveInlineContainer } from "./domUtils";
import { isHTMLElementLike } from "./realmSafeDom";

const INLINE_SURFACE_TOP_PROPERTY = "--ccl-inline-surface-top";

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

	updateInlineSurfacePosition(sizer, target.container);

	const ownerWindow = target.container.ownerDocument.defaultView;
	const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
	if (!ResizeObserverConstructor) {
		return createCleanupController(target.container);
	}

	const observer = new ResizeObserverConstructor(() => {
		updateInlineSurfacePosition(sizer, target.container);
	});
	observer.observe(sizer);

	return {
		dispose: () => {
			observer.disconnect();
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

function updateInlineSurfacePosition(sizer: HTMLElement, container: HTMLElement): void {
	const top = Math.ceil(sizer.offsetTop + sizer.offsetHeight);
	const serializedTop = String(top);
	if (container.dataset.inlineSurfaceTop === serializedTop) {
		return;
	}

	container.dataset.inlineSurfaceTop = serializedTop;
	container.style.setProperty(INLINE_SURFACE_TOP_PROPERTY, `${top}px`);
}

function clearInlineSurfacePosition(container: HTMLElement): void {
	delete container.dataset.inlineSurfaceTop;
	container.style.removeProperty(INLINE_SURFACE_TOP_PROPERTY);
}

function createCleanupController(
	container: HTMLElement,
): InlineSurfaceLayoutController {
	return {
		dispose: () => clearInlineSurfacePosition(container),
	};
}

function createInactiveController(): InlineSurfaceLayoutController {
	return { dispose: () => {} };
}
