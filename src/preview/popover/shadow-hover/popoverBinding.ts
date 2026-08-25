import {
	getOptionalOwnerWindow,
	isElementLike,
	isHTMLElementLike,
	isNodeLike,
} from "shared/ui/dom/realmSafeDom";
import type { HoverPopoverLike, ShadowHoverSession } from "./internal-types";

export const LISTENER_ATTACH_MARKER = "__cclShadowHoverListenersAttached";
export const POPOVER_ANCHOR_KEY = "__cclShadowHoverAnchorEl";
export const POPOVER_ACTUAL_ANCHOR_KEY = "__cclShadowHoverActualAnchorEl";

interface PopoverGeometryCallbacks {
	syncProxyRectForActual(
		session: ShadowHoverSession,
		actual: HTMLElement,
	): HTMLElement;
	syncPopoverTargetAndTransition(session: ShadowHoverSession): void;
}

interface PopoverBindingCallbacks extends PopoverGeometryCallbacks {
	shouldKeepPopoverAlive(
		popover: HoverPopoverLike,
		session: ShadowHoverSession,
	): boolean;
	releaseToNativeLifecycle(
		popover: HoverPopoverLike,
		session: ShadowHoverSession,
	): void;
}

type PopoverPositionPatchState = {
	ownerSession: ShadowHoverSession;
	originalPosition: HoverPopoverLike["position"];
	syncProxyRectForActual: PopoverGeometryCallbacks["syncProxyRectForActual"];
	dispose(): void;
};

type PopoverCloseMethodName = "hide" | "close" | "unload";

type PopoverCloseGuardState = {
	ownerSession: ShadowHoverSession;
	shownState: unknown;
	allowCloseUntil: number;
	methodsPatched: boolean;
	shouldKeepPopoverAlive: PopoverBindingCallbacks["shouldKeepPopoverAlive"];
	restoreMethods: Array<() => void>;
	dispose(): void;
};

type PopoverPinPatchState = {
	ownerSession: ShadowHoverSession;
	dispose(): void;
};

const patchedPopoverPositions = new WeakMap<
	HoverPopoverLike,
	PopoverPositionPatchState
>();

const guardedPopoverCloseMethods = new WeakMap<
	HoverPopoverLike,
	PopoverCloseGuardState
>();

const patchedPopoverPinMethods = new WeakMap<HoverPopoverLike, PopoverPinPatchState>();

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

/** Binds an accepted popover and installs bridge-owned geometry/lifecycle guards. */
export function bindAndPatchPopover(
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
	patchCloseMethods(
		popover,
		ensurePopoverCloseGuardState(popover, session, callbacks),
	);
	patchPinMethod(popover, session, callbacks);
	if (typeof popover.position !== "function") return;
	patchPosition(
		popover,
		ensurePopoverPositionPatchState(popover, session, callbacks),
	);
}

function patchPinMethod(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverBindingCallbacks,
): void {
	const existing = patchedPopoverPinMethods.get(popover);
	if (existing) {
		if (existing.ownerSession === session) return;
		existing.dispose();
	}
	const originalTogglePin = popover.togglePin;
	if (typeof originalTogglePin !== "function") return;

	const patchedTogglePin = function (
		this: HoverPopoverLike,
		pinned?: boolean,
	): unknown {
		const result = originalTogglePin.call(this, pinned);
		if (popover.isPinned) {
			callbacks.releaseToNativeLifecycle(popover, session);
		}
		return result;
	};
	const state: PopoverPinPatchState = {
		ownerSession: session,
		dispose() {
			if (popover.togglePin === patchedTogglePin) {
				popover.togglePin = originalTogglePin;
			}
			if (patchedPopoverPinMethods.get(popover) === state) {
				patchedPopoverPinMethods.delete(popover);
			}
		},
	};
	popover.togglePin = patchedTogglePin;
	patchedPopoverPinMethods.set(popover, state);
}

function ensurePopoverCloseGuardState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverBindingCallbacks,
): PopoverCloseGuardState {
	const existing = guardedPopoverCloseMethods.get(popover);
	if (existing) {
		if (existing.ownerSession === session) return existing;
		existing.dispose();
	}

	const state: PopoverCloseGuardState = {
		ownerSession: session,
		shownState: popover.state ?? 1,
		allowCloseUntil: 0,
		methodsPatched: false,
		shouldKeepPopoverAlive: callbacks.shouldKeepPopoverAlive,
		restoreMethods: [],
		dispose() {
			for (const restore of state.restoreMethods) restore();
			state.restoreMethods.length = 0;
			if (guardedPopoverCloseMethods.get(popover) === state) {
				guardedPopoverCloseMethods.delete(popover);
			}
		},
	};
	guardedPopoverCloseMethods.set(popover, state);
	return state;
}

function patchCloseMethods(
	popover: HoverPopoverLike,
	state: PopoverCloseGuardState,
): void {
	if (state.methodsPatched) return;
	state.methodsPatched = true;
	patchCloseMethod(popover, state, "hide");
	patchCloseMethod(popover, state, "close");
	patchCloseMethod(popover, state, "unload");
}

function patchCloseMethod(
	popover: HoverPopoverLike,
	state: PopoverCloseGuardState,
	methodName: PopoverCloseMethodName,
): void {
	const originalMethod = popover[methodName];
	if (typeof originalMethod !== "function") return;

	const guardedMethod = function (
		this: HoverPopoverLike,
		...args: unknown[]
	): unknown {
		const closeExplicitlyAllowed = state.allowCloseUntil > Date.now();
		if (
			!closeExplicitlyAllowed &&
			state.shouldKeepPopoverAlive(popover, state.ownerSession)
		) {
			restoreShownPopoverState(popover, state);
			return;
		}

		state.dispose();
		return originalMethod.apply(this, args);
	};
	popover[methodName] = guardedMethod;
	state.restoreMethods.push(() => {
		if (popover[methodName] === guardedMethod) {
			popover[methodName] = originalMethod;
		}
	});
}

function restoreShownPopoverState(
	popover: HoverPopoverLike,
	state: PopoverCloseGuardState,
): void {
	if (typeof popover.timer === "number") {
		const ownerWindow =
			popover.hoverEl?.ownerDocument.defaultView ??
			getOptionalOwnerWindow(state.ownerSession.activeAnchor?.actualEl);
		ownerWindow?.clearTimeout(popover.timer);
		popover.timer = 0;
	}
	popover.state = state.shownState;
}

function allowPopoverCloseForInteraction(popover: HoverPopoverLike): void {
	const state = guardedPopoverCloseMethods.get(popover);
	if (state) state.allowCloseUntil = Date.now() + 120;
}

function ensurePopoverPositionPatchState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverGeometryCallbacks,
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

/** Restores native close methods when the bridge releases an accepted popover. */
export function disposePopoverCloseGuard(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	const state = guardedPopoverCloseMethods.get(popover);
	if (state?.ownerSession === session) state.dispose();
}

/** Restores Hover Editor's native pin method when bridge ownership ends. */
export function disposePopoverPinPatch(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	const state = patchedPopoverPinMethods.get(popover);
	if (state?.ownerSession === session) state.dispose();
}

export function scheduleAttachPopoverHoverListeners(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	callbacks: PopoverGeometryCallbacks,
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
		session.overPopover = Boolean(popover.onHover);
		callbacks.syncPopoverTargetAndTransition(session);
	};
	const onEnter = () => onSync();
	const onLeave = () => onSync();
	const onFocusIn = () => onSync();
	const onFocusOut = () => onSync();
	const ownerWindow = hoverEl.ownerDocument.defaultView;
	const allowExplicitClose = (event: Event) => {
		const target = event.target;
		const activeAnchor = getBoundPopoverActualAnchor(popover);
		const proxyAnchor = getBoundPopoverProxyAnchor(popover);
		const insidePopover = isNodeLike(target) && hoverEl.contains(target);
		const insideActualAnchor =
			activeAnchor !== null &&
			isNodeLike(target) &&
			activeAnchor.contains(target);
		const insideProxyAnchor =
			proxyAnchor !== null && isNodeLike(target) && proxyAnchor.contains(target);
		const explicitCloseButton =
			isElementLike(target) && target.closest(".mod-close") !== null;
		if (
			explicitCloseButton ||
			(!insidePopover && !insideActualAnchor && !insideProxyAnchor)
		) {
			allowPopoverCloseForInteraction(popover);
		}
	};
	hoverEl.addEventListener("mouseenter", onEnter, true);
	hoverEl.addEventListener("mouseleave", onLeave, true);
	hoverEl.addEventListener("focusin", onFocusIn, true);
	hoverEl.addEventListener("focusout", onFocusOut, true);
	ownerWindow?.addEventListener("click", allowExplicitClose, true);
	ownerWindow?.addEventListener("contextmenu", allowExplicitClose, true);
	session.teardownPopoverListeners = () => {
		hoverEl.removeEventListener("mouseenter", onEnter, true);
		hoverEl.removeEventListener("mouseleave", onLeave, true);
		hoverEl.removeEventListener("focusin", onFocusIn, true);
		hoverEl.removeEventListener("focusout", onFocusOut, true);
		ownerWindow?.removeEventListener("click", allowExplicitClose, true);
		ownerWindow?.removeEventListener("contextmenu", allowExplicitClose, true);
		hoverElWithMarker[LISTENER_ATTACH_MARKER] = false;
		if (session.attachedPopoverEl === hoverEl) session.attachedPopoverEl = null;
	};
}
