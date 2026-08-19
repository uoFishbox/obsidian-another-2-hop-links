import { enableLogging } from "shared/logging/logger";
import {
	createOwnerMouseEvent,
	getOptionalOwnerWindow,
	isElementLike,
	isHTMLElementLike,
} from "ui/shared/dom/realmSafeDom";
import { debugLog, rectToObject, summarizePopover, summarizeSession } from "./debug";
import { createShadowGeometryProxyStore } from "./geometry-proxy";
import type {
	HoverAnchorTarget,
	HoverParentLike,
	HoverPopoverLike,
	PendingPopoverHandoff,
	PopoverReleaseReason,
	ShadowHoverSession,
} from "./internal-types";

const LISTENER_ATTACH_MARKER = "__cclShadowHoverListenersAttached";
const POPOVER_ANCHOR_KEY = "__cclShadowHoverAnchorEl";
const POPOVER_ACTUAL_ANCHOR_KEY = "__cclShadowHoverActualAnchorEl";

type PopoverPositionPatchState = {
	ownerSession: ShadowHoverSession;
	originalPosition: HoverPopoverLike["position"];
	dispose(): void;
};

const patchedPopoverPositions = new WeakMap<
	HoverPopoverLike,
	PopoverPositionPatchState
>();

export function createShadowHoverSession(): ShadowHoverSession {
	const session: ShadowHoverSession = {
		proxyStore: createShadowGeometryProxyStore(),
		hoveredActuals: new Set(),
		activeAnchor: null,
		activePopover: null,
		activeHoverParent: null,
		pendingHandoff: null,
		requestSeq: 0,
		destroyed: false,
		overAnchor: false,
		overPopover: false,
		attachedPopoverEl: null,
		teardownPopoverListeners: null,
		lastHoverPath: null,
		handoffTimer: null,
		handoffTimerWindow: null,
		logs: [],
		logSeq: 0,
	};
	if (enableLogging) {
		debugLog(session, "session-create", "Created shadow hover session", () =>
			summarizeSession(session),
		);
	}
	return session;
}

export function syncProxyRectForActual(
	session: ShadowHoverSession,
	actual: HTMLElement,
): HTMLElement {
	const proxy = session.proxyStore.sync(actual);
	if (
		!actual.isConnected ||
		proxy.style.width === "0px" ||
		proxy.style.height === "0px"
	) {
		session.hoveredActuals.delete(actual);
	}
	return proxy;
}

export function getActualForProxy(
	session: ShadowHoverSession,
	proxy: HTMLElement,
): HTMLElement | null {
	return session.proxyStore.getActual(proxy);
}

export function setAnchorHovered(
	session: ShadowHoverSession,
	actual: HTMLElement,
	hovered: boolean,
): void {
	if (hovered) session.hoveredActuals.add(actual);
	else session.hoveredActuals.delete(actual);
}

export function isActualHovered(
	session: ShadowHoverSession,
	actual: HTMLElement,
): boolean {
	return session.hoveredActuals.has(actual);
}

export function relayHoverToProxy(
	session: ShadowHoverSession,
	actual: HTMLElement,
	hovered: boolean,
): boolean {
	const proxy = session.proxyStore.get(actual);
	if (!proxy) return false;
	const rect = actual.getBoundingClientRect();
	proxy.dispatchEvent(
		createOwnerMouseEvent(proxy, hovered ? "mouseover" : "mouseout", {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			relatedTarget: null,
		}),
	);
	return true;
}

export function releaseActualAnchor(
	session: ShadowHoverSession,
	actual: HTMLElement,
): void {
	session.hoveredActuals.delete(actual);
	session.proxyStore.release(actual);
}

export function syncSessionAnchor(
	session: ShadowHoverSession,
	actualEl: HTMLElement,
	proxyEl: HTMLElement,
): HoverAnchorTarget {
	const anchor = { actualEl, proxyEl };
	session.activeAnchor = anchor;
	return anchor;
}

export function beginSessionRequest(
	session: ShadowHoverSession,
	anchor: HoverAnchorTarget,
	requestSeq: number,
): void {
	session.activeAnchor = anchor;
	session.requestSeq = requestSeq;
}

export function beginSessionHandoff(
	session: ShadowHoverSession,
	handoff: PendingPopoverHandoff,
): void {
	session.activeAnchor = handoff.toAnchor;
	session.requestSeq = handoff.requestSeq;
	session.pendingHandoff = handoff;
}

export function getActiveSessionAnchor(
	session: ShadowHoverSession,
): HoverAnchorTarget | null {
	return session.activeAnchor;
}

export function getActiveSessionPopover(
	session: ShadowHoverSession,
): HoverPopoverLike | null {
	return session.activePopover;
}

export function getActiveSessionHoverParent(
	session: ShadowHoverSession,
): HoverParentLike | null {
	return session.activeHoverParent;
}

export function getPendingPopoverHandoff(
	session: ShadowHoverSession,
): PendingPopoverHandoff | null {
	return session.pendingHandoff;
}

export function nextSessionRequestSeq(session: ShadowHoverSession): number {
	return session.requestSeq + 1;
}

export function destroySessionState(session: ShadowHoverSession): void {
	session.destroyed = true;
	session.activeAnchor = null;
	session.activePopover = null;
	session.activeHoverParent = null;
	session.pendingHandoff = null;
	session.overAnchor = false;
	session.overPopover = false;
	session.hoveredActuals.clear();
	session.proxyStore.destroy();
}

function closeUnacceptedPopoverUnsafe(
	popover: HoverPopoverLike | null | undefined,
): void {
	if (!popover) return;
	try {
		if (typeof popover.hide === "function") popover.hide();
		else if (typeof popover.close === "function") popover.close();
		else if (typeof popover.unload === "function") popover.unload();
	} catch {
		// Stale popovers are best-effort cleanup only.
	}
}

function scheduleUnacceptedPopoverClose(
	popover: HoverPopoverLike | null | undefined,
): void {
	if (popover) queueMicrotask(() => closeUnacceptedPopoverUnsafe(popover));
}

function scheduleProxyEnterRelay(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	requestSeq: number,
	proxyAnchorEl: HTMLElement,
	actualAnchorEl: HTMLElement,
): void {
	queueMicrotask(() => {
		if (
			session.destroyed ||
			session.requestSeq !== requestSeq ||
			session.activePopover !== popover ||
			!session.hoveredActuals.has(actualAnchorEl) ||
			session.activeAnchor?.actualEl !== actualAnchorEl ||
			session.activeAnchor.proxyEl !== proxyAnchorEl
		) {
			return;
		}
		relayHoverToProxy(session, actualAnchorEl, true);
	});
}

function isActiveElementWithinPopover(popover: HoverPopoverLike): boolean {
	const hoverEl = popover.hoverEl;
	if (!isHTMLElementLike(hoverEl)) return false;
	const activeElement = hoverEl.ownerDocument?.activeElement;
	return isElementLike(activeElement) ? hoverEl.contains(activeElement) : false;
}

function syncShadowTargetState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	reason: string,
): void {
	const actualAnchorEl =
		getBoundPopoverActualAnchor(popover) ?? session.activeAnchor?.actualEl;
	const proxyAnchorEl = actualAnchorEl
		? syncProxyRectForActual(session, actualAnchorEl)
		: (getBoundPopoverProxyAnchor(popover) ?? session.activeAnchor?.proxyEl);
	const overAnchor = actualAnchorEl
		? actualAnchorEl.isConnected && session.hoveredActuals.has(actualAnchorEl)
		: false;
	if (proxyAnchorEl) {
		bindPopoverAnchor(popover, proxyAnchorEl, actualAnchorEl ?? proxyAnchorEl);
	}

	const changed =
		popover.onTarget !== overAnchor || session.overAnchor !== overAnchor;
	popover.onTarget = overAnchor;
	session.overAnchor = overAnchor;
	session.overPopover =
		Boolean(popover.onHover) || isActiveElementWithinPopover(popover);
	if (changed && enableLogging) {
		debugLog(
			session,
			"shadow-target-sync",
			`Shadow target sync (${reason})`,
			() => ({
				overAnchor,
				overPopover: session.overPopover,
				popover: summarizePopover(popover),
			}),
		);
	}
}

export function createRequestHoverParent(
	session: ShadowHoverSession,
	requestSeq: number,
	requestAnchorEl: HTMLElement,
	requestActualAnchorEl = requestAnchorEl,
): HoverParentLike {
	let assignedPopover: HoverPopoverLike | null = null;
	const hoverParent: HoverParentLike = {};
	Object.defineProperty(hoverParent, "hoverPopover", {
		configurable: true,
		enumerable: true,
		get: () => assignedPopover,
		set(value: HoverPopoverLike | null | undefined) {
			const previousPopover = assignedPopover;
			const nextPopover = value ?? null;
			if (enableLogging) {
				debugLog(
					session,
					"hoverParent-set",
					"Request hoverParent.hoverPopover assigned",
					() => ({
						requestSeq,
						requestAnchor: requestAnchorEl.className,
						previous: summarizePopover(previousPopover),
						next: summarizePopover(nextPopover),
					}),
				);
			}
			assignedPopover = nextPopover;

			if (!nextPopover) {
				if (
					previousPopover &&
					session.activePopover === previousPopover &&
					session.activeHoverParent === hoverParent
				) {
					session.activePopover = null;
					session.activeHoverParent = null;
				}
				if (
					previousPopover &&
					session.pendingHandoff?.fromPopover === previousPopover &&
					session.pendingHandoff.fromHoverParent === hoverParent
				) {
					session.pendingHandoff = null;
					clearPendingHandoffTimer(session);
				}
				return;
			}

			if (
				session.destroyed ||
				session.requestSeq !== requestSeq ||
				session.activeAnchor?.proxyEl !== requestAnchorEl
			) {
				if (enableLogging) {
					debugLog(
						session,
						"hoverParent-stale",
						"Discarding stale popover assignment",
						() => ({
							requestSeq,
							latestRequestSeq: session.requestSeq,
							matchesActiveAnchor:
								session.activeAnchor?.proxyEl === requestAnchorEl,
							popover: summarizePopover(nextPopover),
						}),
					);
				}
				assignedPopover = null;
				scheduleUnacceptedPopoverClose(nextPopover);
				return;
			}

			const handoff = session.pendingHandoff;
			session.activePopover = nextPopover;
			session.activeHoverParent = hoverParent;
			session.activeAnchor = {
				actualEl: requestActualAnchorEl,
				proxyEl: requestAnchorEl,
			};
			bindPopoverAnchor(nextPopover, requestAnchorEl, requestActualAnchorEl);
			bindAndPatchPopoverPosition(
				nextPopover,
				session,
				requestAnchorEl,
				requestActualAnchorEl,
			);
			scheduleAttachPopoverHoverListeners(nextPopover, session);
			scheduleProxyEnterRelay(
				nextPopover,
				session,
				requestSeq,
				requestAnchorEl,
				requestActualAnchorEl,
			);
			syncPopoverTargetAndTransition(session, "hoverParent-set");

			if (
				handoff?.requestSeq === requestSeq &&
				handoff.fromPopover !== nextPopover
			) {
				if (enableLogging) {
					debugLog(
						session,
						"handoff-complete",
						"Releasing replaced popover after new assignment",
						() => ({
							requestSeq,
							from: summarizePopover(handoff.fromPopover),
							to: summarizePopover(nextPopover),
						}),
					);
				}
				session.pendingHandoff = null;
				releasePopoverToNativeLifecycle(
					handoff.fromPopover,
					session,
					"handoff-complete",
				);
				clearPendingHandoffTimer(session);
			}
		},
	});
	return hoverParent;
}

function bindPopoverAnchor(
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

function bindAndPatchPopoverPosition(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	proxyAnchorEl?: HTMLElement,
	actualAnchorEl?: HTMLElement,
): void {
	if (enableLogging) {
		debugLog(session, "popover-patch", "Patching popover position", () =>
			summarizePopover(popover),
		);
	}
	const boundActualAnchor = isHTMLElementLike(actualAnchorEl)
		? actualAnchorEl
		: getBoundPopoverActualAnchor(popover);
	const syncedProxyAnchor = boundActualAnchor
		? syncProxyRectForActual(session, boundActualAnchor)
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
	patchPosition(popover, ensurePopoverPositionPatchState(popover, session));
}

function ensurePopoverPositionPatchState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): PopoverPositionPatchState {
	const existing = patchedPopoverPositions.get(popover);
	if (existing) {
		if (existing.ownerSession === session) return existing;
		if (enableLogging) {
			debugLog(
				session,
				"popover-patch-owner-change",
				"Reassigning popover patch owner",
				() => ({
					popover: summarizePopover(popover),
					previousOwner: summarizeSession(existing.ownerSession),
					nextOwner: summarizeSession(session),
				}),
			);
		}
		existing.dispose();
	}

	const state: PopoverPositionPatchState = {
		ownerSession: session,
		originalPosition: popover.position,
		dispose() {
			if (patchedPopoverPositions.get(popover) === state)
				patchedPopoverPositions.delete(popover);
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
			? syncProxyRectForActual(session, actualAnchorEl)
			: getBoundPopoverProxyAnchor(this);
		if (proxyAnchorEl) this.targetEl = proxyAnchorEl;
		if (enableLogging) {
			debugLog(session, "popover-position", "Popover position() invoked", () => ({
				argsCount: args.length,
				anchorRect: proxyAnchorEl
					? rectToObject(proxyAnchorEl.getBoundingClientRect())
					: null,
			}));
		}
		return originalPosition.apply(this, args);
	};
	popover.position = patchedPosition;
	const disposeBase = state.dispose;
	state.dispose = () => {
		if (popover.position === patchedPosition) popover.position = originalPosition;
		disposeBase();
	};
}

function disposePopoverPositionPatch(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	const state = patchedPopoverPositions.get(popover);
	if (state?.ownerSession === session) state.dispose();
}

export function scheduleAttachPopoverHoverListeners(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	retries = 8,
): void {
	if (session.destroyed) return;
	const hoverEl = popover.hoverEl;
	if (!isHTMLElementLike(hoverEl)) {
		if (retries <= 0) {
			if (enableLogging) {
				debugLog(
					session,
					"popover-listeners-giveup",
					"Popover hoverEl never appeared",
					() => summarizePopover(popover),
				);
			}
			return;
		}
		const ownerWindow = getOptionalOwnerWindow(session.activeAnchor?.actualEl);
		ownerWindow?.requestAnimationFrame(() =>
			scheduleAttachPopoverHoverListeners(popover, session, retries - 1),
		);
		return;
	}

	const hoverElWithMarker = hoverEl as HTMLElement & Record<string, unknown>;
	if (hoverElWithMarker[LISTENER_ATTACH_MARKER]) return;
	hoverElWithMarker[LISTENER_ATTACH_MARKER] = true;
	session.attachedPopoverEl = hoverEl;
	session.teardownPopoverListeners?.();
	const onSync = (type: string) => {
		session.overPopover =
			Boolean(popover.onHover) || isActiveElementWithinPopover(popover);
		if (enableLogging) {
			debugLog(session, "popover-sync", `Popover sync from ${type}`, () =>
				summarizeSession(session),
			);
		}
		syncPopoverTargetAndTransition(session, type);
	};
	const onEnter = () => onSync("mouseenter");
	const onLeave = () => onSync("mouseleave");
	const onFocusIn = () => onSync("focusin");
	const onFocusOut = () => onSync("focusout");
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

export function syncPopoverTargetAndTransition(
	session: ShadowHoverSession,
	reason = "manual-sync",
): void {
	const popover = session.activePopover;
	if (!popover) return;
	syncShadowTargetState(popover, session, reason);
	if (typeof popover.transition !== "function") return;
	if (enableLogging) {
		debugLog(
			session,
			"native-transition",
			`Re-evaluating popover transition (${reason})`,
			() => summarizeSession(session),
		);
	}
	popover.transition();
}

export function releasePopoverToNativeLifecycle(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	reason: PopoverReleaseReason,
): void {
	if (enableLogging) {
		debugLog(session, "popover-release", `Releasing popover (${reason})`, () => ({
			popover: summarizePopover(popover),
			session: summarizeSession(session),
		}));
	}
	if (session.pendingHandoff?.fromPopover === popover) {
		session.pendingHandoff = null;
		clearPendingHandoffTimer(session);
	}
	const wasActive = session.activePopover === popover;
	const actualAnchor = getBoundPopoverActualAnchor(popover);
	if (actualAnchor) {
		const wasHovered = session.hoveredActuals.delete(actualAnchor);
		if (wasHovered) relayHoverToProxy(session, actualAnchor, false);
	}
	popover.onTarget = false;
	if (wasActive) {
		session.activePopover = null;
		session.activeHoverParent = null;
		session.overAnchor = false;
		session.overPopover = false;
	}
	if (session.attachedPopoverEl === popover.hoverEl) {
		session.teardownPopoverListeners?.();
		session.teardownPopoverListeners = null;
	}
	try {
		popover.transition?.();
	} catch (error) {
		if (enableLogging) {
			debugLog(
				session,
				"popover-release-transition-error",
				`Native transition failed during release (${reason})`,
				() => ({
					error: String(error),
					popover: summarizePopover(popover),
				}),
			);
		}
	} finally {
		disposePopoverPositionPatch(popover, session);
		if (actualAnchor) releaseActualAnchor(session, actualAnchor);
		delete popover[POPOVER_ANCHOR_KEY];
		delete popover[POPOVER_ACTUAL_ANCHOR_KEY];
	}
}

export function expirePendingPopoverHandoff(
	session: ShadowHoverSession,
	requestSeq: number,
): PendingPopoverHandoff | null {
	const handoff = session.pendingHandoff;
	if (!handoff || handoff.requestSeq !== requestSeq) return null;
	session.pendingHandoff = null;
	clearPendingHandoffTimer(session);
	return handoff;
}

export function clearPendingHandoffTimer(session: ShadowHoverSession): void {
	if (session.handoffTimer == null) return;
	session.handoffTimerWindow?.clearTimeout(session.handoffTimer);
	session.handoffTimer = null;
	session.handoffTimerWindow = null;
}
