import {
	LISTENER_ATTACH_MARKER,
	POPOVER_ACTUAL_ANCHOR_KEY,
	POPOVER_ANCHOR_KEY,
} from "./internal-constants";
import { debugLog, summarizePopover, summarizeSession } from "./debug";
import { enableLogging } from "shared/logging/logger";
import { rectToObject } from "./dom-utils";
import type {
	HoverAnchorTarget,
	HoverParentLike,
	HoverPopoverLike,
	HoverSessionEvent,
	HoverSessionInteractionEvent,
	PendingPopoverHandoff,
	PopoverReleaseReason,
	ShadowHoverSession,
} from "./internal-types";
import type { ShadowAnchorRegistry } from "./registry";
import {
	createInitialHoverSessionState,
	createInitialHoverSessionInteractionState,
	getSessionAnchor,
	getSessionPopover,
	transitionHoverSession,
	transitionHoverSessionInteraction,
} from "./state-machine";
import {
	getOptionalOwnerWindow,
	isElementLike,
	isHTMLElementLike,
} from "ui/shared/dom/realmSafeDom";

type PopoverPositionPatchState = {
	ownerSession: ShadowHoverSession;
	originalPosition: HoverPopoverLike["position"];
	dispose(): void;
};

const patchedPopoverPositions = new WeakMap<
	HoverPopoverLike,
	PopoverPositionPatchState
>();

function closeUnacceptedPopoverUnsafe(
	popover: HoverPopoverLike | null | undefined,
): void {
	if (!popover) {
		return;
	}

	try {
		if (typeof popover.hide === "function") {
			popover.hide();
			return;
		}
		if (typeof popover.close === "function") {
			popover.close();
			return;
		}
		if (typeof popover.unload === "function") {
			popover.unload();
		}
	} catch {
		// Ignore stale cleanup failures.
	}
}

function scheduleUnacceptedPopoverClose(
	popover: HoverPopoverLike | null | undefined,
): void {
	if (!popover) {
		return;
	}

	queueMicrotask(() => {
		closeUnacceptedPopoverUnsafe(popover);
	});
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
			isSessionDestroyed(session) ||
			session.state.requestSeq !== requestSeq ||
			getActiveSessionPopover(session) !== popover ||
			!session.anchorRegistry.isActualHovered(actualAnchorEl)
		) {
			return;
		}
		const activeAnchor = getActiveSessionAnchor(session);
		if (
			activeAnchor?.actualEl !== actualAnchorEl ||
			activeAnchor.proxyEl !== proxyAnchorEl
		) {
			return;
		}
		session.anchorRegistry.relayHoverToProxy(actualAnchorEl, true);
	});
}

function withPatchedPosition(
	dispose: () => void,
	popover: HoverPopoverLike,
	patched: HoverPopoverLike["position"],
	original: HoverPopoverLike["position"],
): () => void {
	return () => {
		restorePatchedPosition(popover, patched, original);
		dispose();
	};
}

function restorePatchedPosition(
	popover: HoverPopoverLike,
	patched: HoverPopoverLike["position"],
	original: HoverPopoverLike["position"],
): void {
	if (!patched || popover.position !== patched) {
		return;
	}
	if (typeof original === "function") {
		popover.position = original;
		return;
	}
	delete popover.position;
}

function disposePopoverPositionPatch(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	const state = patchedPopoverPositions.get(popover);
	if (state?.ownerSession === session) {
		state.dispose();
	}
}

function isActiveElementWithinPopover(popover: HoverPopoverLike): boolean {
	const hoverEl = popover.hoverEl;
	if (!isHTMLElementLike(hoverEl)) {
		return false;
	}
	const activeElement = hoverEl.ownerDocument?.activeElement;
	return isElementLike(activeElement) ? hoverEl.contains(activeElement) : false;
}

function syncShadowTargetState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	reason: string,
): boolean {
	const activeAnchor = getSessionAnchor(session.state);
	const actualAnchorEl =
		getBoundPopoverActualAnchor(popover) ?? activeAnchor?.actualEl;
	const proxyAnchorEl = actualAnchorEl
		? session.anchorRegistry.syncProxyRectForActual(actualAnchorEl)
		: (getBoundPopoverProxyAnchor(popover) ?? activeAnchor?.proxyEl);
	const overAnchor = actualAnchorEl
		? actualAnchorEl.isConnected &&
			session.anchorRegistry.isActualHovered(actualAnchorEl)
		: proxyAnchorEl
			? session.anchorRegistry.isHovered(proxyAnchorEl)
			: false;
	if (proxyAnchorEl) {
		bindPopoverAnchor(popover, proxyAnchorEl, actualAnchorEl ?? proxyAnchorEl);
	}

	const changed =
		popover.onTarget !== overAnchor ||
		session.interaction.overAnchor !== overAnchor;
	popover.onTarget = overAnchor;
	const overPopover =
		Boolean(popover.onHover) || isActiveElementWithinPopover(popover);
	transitionSessionInteraction(session, {
		type: "interaction-sync",
		overAnchor,
		overPopover,
	});
	if (changed && enableLogging) {
		debugLog(
			session,
			"shadow-target-sync",
			`Shadow target sync (${reason})`,
			() => ({
				overAnchor,
				overPopover: session.interaction.overPopover,
				popover: summarizePopover(popover),
			}),
		);
	}
	return changed;
}

export function createShadowHoverSession(
	anchorRegistry: ShadowAnchorRegistry,
): ShadowHoverSession {
	const session: ShadowHoverSession = {
		anchorRegistry,
		state: createInitialHoverSessionState(),
		interaction: createInitialHoverSessionInteractionState(),
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

export function transitionSession(
	session: ShadowHoverSession,
	event: HoverSessionEvent,
): void {
	session.state = transitionHoverSession(session.state, event);
}

export function transitionSessionInteraction(
	session: ShadowHoverSession,
	event: HoverSessionInteractionEvent,
): void {
	// transitionHoverSessionInteraction mutates `session.interaction` in place to
	// avoid per-event allocation on the hover/pointermove hot path.
	transitionHoverSessionInteraction(session.interaction, event);
}

export function syncSessionAnchor(
	session: ShadowHoverSession,
	actualEl: HTMLElement,
	proxyEl: HTMLElement,
): HoverAnchorTarget {
	const anchor = { actualEl, proxyEl };
	transitionSession(session, { type: "anchor-sync", anchor });
	return anchor;
}

export function getActiveSessionAnchor(
	session: ShadowHoverSession,
): HoverAnchorTarget | null {
	return getSessionAnchor(session.state);
}

export function getActiveSessionPopover(
	session: ShadowHoverSession,
): HoverPopoverLike | null {
	return getSessionPopover(session.state);
}

export function getPendingPopoverHandoff(
	session: ShadowHoverSession,
): PendingPopoverHandoff | null {
	if (session.state.type !== "handoff") {
		return null;
	}
	return {
		fromPopover: session.state.from.popover,
		fromActualAnchor: session.state.from.anchor.actualEl,
		toActualAnchor: session.state.to.actualEl,
		requestSeq: session.state.requestSeq,
	};
}

export function nextSessionRequestSeq(session: ShadowHoverSession): number {
	return session.state.requestSeq + 1;
}

export function isSessionDestroyed(session: ShadowHoverSession): boolean {
	return session.state.type === "destroyed";
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
		get() {
			return assignedPopover;
		},
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
				if (previousPopover) {
					transitionSession(session, {
						type: "popover-cleared",
						popover: previousPopover,
						hoverParent,
					});
				}
				return;
			}
			const activeAnchor = getActiveSessionAnchor(session);
			if (
				isSessionDestroyed(session) ||
				session.state.requestSeq !== requestSeq ||
				activeAnchor?.proxyEl !== requestAnchorEl
			) {
				if (enableLogging) {
					debugLog(
						session,
						"hoverParent-stale",
						"Discarding stale popover assignment",
						() => ({
							requestSeq,
							latestRequestSeq: session.state.requestSeq,
							matchesActiveAnchor:
								activeAnchor?.proxyEl === requestAnchorEl,
							popover: summarizePopover(nextPopover),
						}),
					);
				}
				const stalePopover = nextPopover;
				assignedPopover = null;
				scheduleUnacceptedPopoverClose(stalePopover);
				return;
			}
			const handoff = getPendingPopoverHandoff(session);
			transitionSession(session, {
				type: "popover-assigned",
				popover: nextPopover,
				hoverParent,
				anchor: {
					actualEl: requestActualAnchorEl,
					proxyEl: requestAnchorEl,
				},
				requestSeq,
			});
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
				handoff &&
				handoff.requestSeq === requestSeq &&
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
	if (!popover) {
		return null;
	}
	const anchor = popover[POPOVER_ANCHOR_KEY];
	if (isHTMLElementLike(anchor)) {
		return anchor;
	}
	return isHTMLElementLike(popover.targetEl) ? popover.targetEl : null;
}

export function getBoundPopoverActualAnchor(
	popover: HoverPopoverLike | null | undefined,
): HTMLElement | null {
	if (!popover) {
		return null;
	}
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
		? session.anchorRegistry.syncProxyRectForActual(boundActualAnchor)
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
	if (typeof popover.position !== "function") {
		return;
	}
	const state = ensurePopoverPositionPatchState(popover, session);
	patchPosition(popover, state);
}

function ensurePopoverPositionPatchState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): PopoverPositionPatchState {
	const existingState = patchedPopoverPositions.get(popover);
	if (existingState) {
		if (existingState.ownerSession === session) {
			return existingState;
		}
		if (enableLogging) {
			debugLog(
				session,
				"popover-patch-owner-change",
				"Reassigning popover patch owner",
				() => ({
					popover: summarizePopover(popover),
					previousOwner: summarizeSession(existingState.ownerSession),
					nextOwner: summarizeSession(session),
				}),
			);
		}
		existingState.dispose();
	}

	const state: PopoverPositionPatchState = {
		ownerSession: session,
		originalPosition: popover.position,
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
	const { originalPosition, ownerSession: session } = state;
	if (typeof originalPosition !== "function") {
		return;
	}
	const patchedPosition = function patchedPosition(
		this: HoverPopoverLike,
		...args: unknown[]
	) {
		const actualAnchorEl = getBoundPopoverActualAnchor(this);
		const proxyAnchorEl = actualAnchorEl
			? session.anchorRegistry.syncProxyRectForActual(actualAnchorEl)
			: getBoundPopoverProxyAnchor(this);
		if (proxyAnchorEl) {
			this.targetEl = proxyAnchorEl;
		}
		if (enableLogging) {
			debugLog(session, "popover-position", "Popover position() invoked", () => ({
				argsCount: args.length,
				anchorRect: proxyAnchorEl
					? rectToObject(proxyAnchorEl.getBoundingClientRect())
					: null,
			}));
		}
		const next = originalPosition;
		if (typeof next === "function") {
			return next.apply(this, args);
		}
	};
	popover.position = patchedPosition;
	state.dispose = withPatchedPosition(
		state.dispose,
		popover,
		patchedPosition,
		originalPosition,
	);
}

export function scheduleAttachPopoverHoverListeners(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	retries = 8,
): void {
	if (isSessionDestroyed(session)) {
		return;
	}

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
		const anchor = getActiveSessionAnchor(session)?.actualEl;
		const ownerWindow = getOptionalOwnerWindow(anchor);
		if (!ownerWindow) return;
		ownerWindow.requestAnimationFrame(() =>
			scheduleAttachPopoverHoverListeners(popover, session, retries - 1),
		);
		return;
	}

	const hoverElWithMarker = hoverEl as HTMLElement & Record<string, unknown>;
	if (hoverElWithMarker[LISTENER_ATTACH_MARKER]) {
		return;
	}
	hoverElWithMarker[LISTENER_ATTACH_MARKER] = true;
	session.attachedPopoverEl = hoverEl;
	session.teardownPopoverListeners?.();
	const onSync = (type: string) => {
		transitionSessionInteraction(session, {
			type: "popover-hover-sync",
			overPopover:
				Boolean(popover.onHover) || isActiveElementWithinPopover(popover),
		});
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
		if (session.attachedPopoverEl === hoverEl) {
			session.attachedPopoverEl = null;
		}
	};
}

export function syncPopoverTargetAndTransition(
	session: ShadowHoverSession,
	reason = "manual-sync",
): void {
	const popover = getActiveSessionPopover(session);
	if (!popover) {
		return;
	}
	syncShadowTargetState(popover, session, reason);
	if (typeof popover.transition === "function") {
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
	const wasActive = getSessionPopover(session.state) === popover;
	if (getPendingPopoverHandoff(session)?.fromPopover === popover) {
		clearPendingHandoffTimer(session);
	}
	const actualAnchor = getBoundPopoverActualAnchor(popover);
	if (actualAnchor) {
		const wasHovered = session.anchorRegistry.isActualHovered(actualAnchor);
		session.anchorRegistry.setHovered(actualAnchor, false);
		if (wasHovered) {
			session.anchorRegistry.relayHoverToProxy(actualAnchor, false);
		}
	}
	popover.onTarget = false;
	transitionSession(session, { type: "popover-released", popover });
	if (wasActive) {
		transitionSessionInteraction(session, { type: "interaction-reset" });
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
				() => ({ error: String(error), popover: summarizePopover(popover) }),
			);
		}
	} finally {
		disposePopoverPositionPatch(popover, session);
		if (actualAnchor) {
			session.anchorRegistry.releaseActual(actualAnchor);
		}
		delete popover[POPOVER_ANCHOR_KEY];
		delete popover[POPOVER_ACTUAL_ANCHOR_KEY];
	}
}

export function expirePendingPopoverHandoff(
	session: ShadowHoverSession,
	requestSeq: number,
): PendingPopoverHandoff | null {
	const handoff = getPendingPopoverHandoff(session);
	if (!handoff || handoff.requestSeq !== requestSeq) {
		return null;
	}
	transitionSession(session, { type: "handoff-timeout", requestSeq });
	clearPendingHandoffTimer(session);
	return handoff;
}

export function clearPendingHandoffTimer(session: ShadowHoverSession): void {
	if (session.handoffTimer != null) {
		session.handoffTimerWindow?.clearTimeout(session.handoffTimer);
		session.handoffTimer = null;
		session.handoffTimerWindow = null;
	}
}
