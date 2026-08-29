import { createOwnerMouseEvent } from "shared/ui/dom/realmSafeDom";
import { createShadowGeometryProxyStore } from "./geometry-proxy";
import type {
	HoverAnchorTarget,
	HoverParentLike,
	HoverPopoverLike,
	PendingPopoverHandoff,
	ShadowHoverSession,
} from "./internal-types";
import {
	bindAndPatchPopover,
	bindPopoverAnchor,
	disposePopoverCloseGuard,
	disposePopoverPinPatch,
	disposePopoverPositionPatch,
	getBoundPopoverActualAnchor,
	getBoundPopoverProxyAnchor,
	POPOVER_ACTUAL_ANCHOR_KEY,
	POPOVER_ANCHOR_KEY,
	scheduleAttachPopoverHoverListeners,
} from "./popoverBinding";

export {
	getBoundPopoverActualAnchor,
	getBoundPopoverAnchor,
	getBoundPopoverProxyAnchor,
} from "./popoverBinding";

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
		handoffTimer: null,
		handoffTimerWindow: null,
	};
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
			bubbles: false,
			cancelable: true,
			composed: false,
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

function syncShadowTargetState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
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

	popover.onTarget = overAnchor;
	session.overAnchor = overAnchor;
	session.overPopover = Boolean(popover.onHover);
}

function shouldKeepPopoverAlive(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): boolean {
	if (session.destroyed || session.activePopover !== popover) return false;
	syncShadowTargetState(popover, session);
	return session.overAnchor;
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
			bindAndPatchPopover(
				nextPopover,
				session,
				{
					syncProxyRectForActual,
					syncPopoverTargetAndTransition,
					shouldKeepPopoverAlive,
					releaseToNativeLifecycle: releasePopoverToNativeLifecycle,
				},
				requestAnchorEl,
				requestActualAnchorEl,
			);
			scheduleAttachPopoverHoverListeners(nextPopover, session, {
				syncProxyRectForActual,
				syncPopoverTargetAndTransition,
			});
			scheduleProxyEnterRelay(
				nextPopover,
				session,
				requestSeq,
				requestAnchorEl,
				requestActualAnchorEl,
			);
			syncPopoverTargetAndTransition(session);

			if (
				handoff?.requestSeq === requestSeq &&
				handoff.fromPopover !== nextPopover
			) {
				session.pendingHandoff = null;
				releasePopoverToNativeLifecycle(handoff.fromPopover, session);
				clearPendingHandoffTimer(session);
			}
		},
	});
	return hoverParent;
}

export function syncPopoverTargetAndTransition(session: ShadowHoverSession): void {
	const popover = session.activePopover;
	if (!popover) return;
	syncShadowTargetState(popover, session);
	if (typeof popover.transition !== "function") return;
	popover.transition();
}

export function releasePopoverToNativeLifecycle(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
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
	disposePopoverCloseGuard(popover, session);
	disposePopoverPinPatch(popover, session);
	try {
		popover.transition?.();
	} catch {
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
