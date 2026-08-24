import { getOptionalOwnerWindow, isHTMLElementLike } from "ui/shared/dom/realmSafeDom";
import type { HoverPopoverLike, ShadowHoverSession } from "./internal-types";

export const LISTENER_ATTACH_MARKER = "__cclShadowHoverListenersAttached";
export const POPOVER_ANCHOR_KEY = "__cclShadowHoverAnchorEl";
export const POPOVER_ACTUAL_ANCHOR_KEY = "__cclShadowHoverActualAnchorEl";

export interface PopoverBindingCallbacks {
	syncProxyRectForActual(
		session: ShadowHoverSession,
		actual: HTMLElement,
	): HTMLElement;
	syncPopoverTargetAndTransition(session: ShadowHoverSession): void;
}

type PopoverPositionPatchState = {
	ownerSession: ShadowHoverSession;
	originalPosition: HoverPopoverLike["position"];
	syncProxyRectForActual: PopoverBindingCallbacks["syncProxyRectForActual"];
	dispose(): void;
};

const patchedPopoverPositions = new WeakMap<
	HoverPopoverLike,
	PopoverPositionPatchState
>();

export function bindPopoverAnchor(
	popover: HoverPopoverLike,
	proxyAnchorEl: HTMLElement,
	actualAnchorEl = proxyAnchorEl,
): void {
	popover[POPOVER_ANCHOR_KEY] = proxyAnchorEl;
	popover[POPOVER_ACTUAL_ANCHOR_KEY] = actualAnchorEl;
	popover.targetEl = proxyAnchorEl;
}

export function getBoundPopoverProxyAnchor(
	popover: HoverPopoverLike | null | undefined,
): HTMLElement | null {
	if (!popover) return null;
	const anchor = popover[POPOVER_ANCHOR_KEY];
	return isHTMLElementLike(anchor)
		? anchor
		: isHTMLElementLike(popover.targetEl)
			? popover.targetEl
			: null;
}

export function getBoundPopoverActualAnchor(
	popover: HoverPopoverLike | null | undefined,
): HTMLElement | null {
	if (!popover) return null;
	const anchor = popover[POPOVER_ACTUAL_ANCHOR_KEY];
	return isHTMLElementLike(anchor) ? anchor : null;
}

export function getBoundPopoverAnchor(
	popover: HoverPopoverLike | null | undefined,
): HTMLElement | null {
	return getBoundPopoverProxyAnchor(popover);
}

export function bindAndPatchPopoverPosition(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverBindingCallbacks,
	proxyAnchorEl?: HTMLElement,
	actualAnchorEl?: HTMLElement,
): void {
	const boundActualAnchor = isHTMLElementLike(actualAnchorEl)
		? actualAnchorEl
		: getBoundPopoverActualAnchor(popover);
	const syncedProxyAnchor = boundActualAnchor
		? callbacks.syncProxyRectForActual(session, boundActualAnchor)
		: isHTMLElementLike(proxyAnchorEl)
			? proxyAnchorEl
			: getBoundPopoverProxyAnchor(popover);
	if (syncedProxyAnchor) {
		bindPopoverAnchor(
			popover,
			syncedProxyAnchor,
			boundActualAnchor ?? syncedProxyAnchor,
		);
	}
	if (typeof popover.position !== "function") return;
	patchPosition(
		popover,
		ensurePopoverPositionPatchState(popover, session, callbacks),
	);
}

function ensurePopoverPositionPatchState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverBindingCallbacks,
): PopoverPositionPatchState {
	const existing = patchedPopoverPositions.get(popover);
	if (existing) {
		if (existing.ownerSession === session) return existing;
		existing.dispose();
	}

	const state: PopoverPositionPatchState = {
		ownerSession: session,
		originalPosition: popover.position,
		syncProxyRectForActual: callbacks.syncProxyRectForActual,
		dispose() {
			if (patchedPopoverPositions.get(popover) === state) {
				patchedPopoverPositions.delete(popover);
			}
		},
	};
	patchedPopoverPositions.set(popover, state);
	return state;
}

function patchPosition(
	popover: HoverPopoverLike,
	state: PopoverPositionPatchState,
): void {
	const originalPosition = state.originalPosition;
	if (typeof originalPosition !== "function") return;
	const session = state.ownerSession;
	const patchedPosition = function (this: HoverPopoverLike, ...args: unknown[]) {
		const actualAnchorEl = getBoundPopoverActualAnchor(this);
		const proxyAnchorEl = actualAnchorEl
			? state.syncProxyRectForActual(session, actualAnchorEl)
			: getBoundPopoverProxyAnchor(this);
		if (proxyAnchorEl) this.targetEl = proxyAnchorEl;
		return originalPosition.apply(this, args);
	};
	popover.position = patchedPosition;
	const disposeBase = state.dispose;
	state.dispose = () => {
		if (popover.position === patchedPosition) popover.position = originalPosition;
		disposeBase();
	};
}

export function disposePopoverPositionPatch(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	const state = patchedPopoverPositions.get(popover);
	if (state?.ownerSession === session) state.dispose();
}

export function scheduleAttachPopoverHoverListeners(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverBindingCallbacks,
	retries = 8,
): void {
	if (session.destroyed) return;
	const hoverEl = popover.hoverEl;
	if (!isHTMLElementLike(hoverEl)) {
		if (retries <= 0) {
			return;
		}
		const ownerWindow = getOptionalOwnerWindow(session.activeAnchor?.actualEl);
		ownerWindow?.requestAnimationFrame(() =>
			scheduleAttachPopoverHoverListeners(
				popover,
				session,
				callbacks,
				retries - 1,
			),
		);
		return;
	}

	const hoverElWithMarker = hoverEl as HTMLElement & Record<string, unknown>;
	if (hoverElWithMarker[LISTENER_ATTACH_MARKER]) return;
	hoverElWithMarker[LISTENER_ATTACH_MARKER] = true;
	session.attachedPopoverEl = hoverEl;
	session.teardownPopoverListeners?.();
	const onSync = () => {
		session.overPopover =
			Boolean(popover.onHover) || isActiveElementWithinPopover(popover);
		callbacks.syncPopoverTargetAndTransition(session);
	};
	const onEnter = () => onSync();
	const onLeave = () => onSync();
	const onFocusIn = () => onSync();
	const onFocusOut = () => onSync();
	hoverEl.addEventListener("mouseenter", onEnter, true);
	hoverEl.addEventListener("mouseleave", onLeave, true);
	hoverEl.addEventListener("focusin", onFocusIn, true);
	hoverEl.addEventListener("focusout", onFocusOut, true);
	session.teardownPopoverListeners = () => {
		hoverEl.removeEventListener("mouseenter", onEnter, true);
		hoverEl.removeEventListener("mouseleave", onLeave, true);
		hoverEl.removeEventListener("focusin", onFocusIn, true);
		hoverEl.removeEventListener("focusout", onFocusOut, true);
		hoverElWithMarker[LISTENER_ATTACH_MARKER] = false;
		if (session.attachedPopoverEl === hoverEl) session.attachedPopoverEl = null;
	};
}

export function isActiveElementWithinPopover(popover: HoverPopoverLike): boolean {
	const hoverEl = popover.hoverEl;
	if (!isHTMLElementLike(hoverEl)) return false;
	const activeElement = hoverEl.ownerDocument?.activeElement;
	return isElementWithin(hoverEl, activeElement);
}

function isElementWithin(hoverEl: HTMLElement, activeElement: Element | null): boolean {
	return activeElement ? hoverEl.contains(activeElement) : false;
}
