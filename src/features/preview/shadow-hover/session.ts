import {
	LISTENER_ATTACH_MARKER,
	POPOVER_ACTUAL_ANCHOR_KEY,
	POPOVER_ANCHOR_KEY,
} from "./internal-constants";
import { debugLog, summarizePopover, summarizeSession } from "./debug";
import { enableLogging } from "utils/logger";
import { rectToObject } from "./dom-utils";
import type {
	HoverAnchorTarget,
	HoverParentLike,
	HoverPopoverLike,
	HoverSessionCloseReason,
	HoverSessionEvent,
	HoverSessionInteractionEvent,
	PendingPopoverHandoff,
	PopoverPatchState,
	ShadowHoverSession,
} from "./internal-types";
import type { ShadowAnchorRegistry } from "./registry";
import {
	createInitialHoverSessionState,
	createInitialHoverSessionInteractionState,
	getSessionAnchor,
	getSessionPopover,
	getSessionPopoverHoverParent,
	transitionHoverSession,
	transitionHoverSessionInteraction,
} from "./state-machine";
import { isElementLike, isHTMLElementLike, isNodeLike } from "ui/utils/realmSafeDom";

const patchedPopovers = new WeakMap<HoverPopoverLike, PopoverPatchState>();

type PopoverMethodName = keyof PopoverPatchState["originals"];

export function closePopoverUnsafe(popover: HoverPopoverLike | null | undefined): void {
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

function scheduleUnsafePopoverClose(
	popover: HoverPopoverLike | null | undefined,
): void {
	if (!popover) {
		return;
	}

	queueMicrotask(() => {
		closePopoverUnsafe(popover);
	});
}

function setPopoverFocused(popover: HoverPopoverLike, focused: boolean): void {
	try {
		if (typeof popover.setIsFocused === "function") {
			popover.setIsFocused(focused);
			return;
		}
		popover.isFocused = focused;
	} catch {
		popover.isFocused = focused;
	}
}

function callOriginalClose(popover: HoverPopoverLike): boolean {
	const originals = patchedPopovers.get(popover)?.originals;
	const candidates = [originals?.hide, originals?.close, originals?.unload];
	for (const candidate of candidates) {
		if (typeof candidate === "function") {
			candidate.call(popover);
			return true;
		}
	}
	return false;
}

function withPatchedMethod(
	dispose: () => void,
	popover: HoverPopoverLike,
	method: PopoverMethodName,
	patched: ((...args: unknown[]) => unknown) | undefined,
	original: ((...args: unknown[]) => unknown) | undefined,
): () => void {
	return () => {
		restorePatchedMethod(popover, method, patched, original);
		dispose();
	};
}

function restorePatchedMethod(
	popover: HoverPopoverLike,
	method: PopoverMethodName,
	patched: ((...args: unknown[]) => unknown) | undefined,
	original: ((...args: unknown[]) => unknown) | undefined,
): void {
	if (!patched || popover[method] !== patched) {
		return;
	}
	if (typeof original === "function") {
		popover[method] = original;
		return;
	}
	delete popover[method];
}

function disposePopoverPatch(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	const state = patchedPopovers.get(popover);
	if (state?.ownerSession === session) {
		state.dispose();
	}
}

function isElementWithinPopover(
	popover: HoverPopoverLike,
	element: EventTarget | null | undefined,
): boolean {
	if (!isHTMLElementLike(popover.hoverEl) || !isNodeLike(element)) {
		return false;
	}
	return popover.hoverEl.contains(element);
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

function shouldKeepAlive(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): boolean {
	syncShadowTargetState(popover, session, "should-keepalive");
	return (
		session.interaction.overAnchor ||
		Boolean(popover.onHover) ||
		Boolean(popover.isFocused) ||
		isActiveElementWithinPopover(popover)
	);
}

function hasRecentOutsideInteraction(session: ShadowHoverSession): boolean {
	return session.interaction.outsideInteractionUntil > Date.now();
}

function shouldBlockClose(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	kind: string,
): boolean {
	if (
		session.state.type === "destroyed" ||
		getSessionPopover(session.state) !== popover ||
		session.allowClose
	) {
		return false;
	}
	if (hasRecentOutsideInteraction(session)) {
		if (enableLogging) {
			debugLog(
				session,
				"close-allowed-outside",
				`${kind}() allowed because an outside interaction was observed`,
				() => summarizeSession(session),
			);
		}
		return false;
	}
	return shouldKeepAlive(popover, session);
}

function restoreShownState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	reason: string,
): void {
	clearPopoverInternalTimer(popover);
	if (session.shownStateValue == null) {
		session.shownStateValue = popover.state ?? 1;
	}
	if (session.shownStateValue != null) {
		popover.state = session.shownStateValue;
	}
	syncShadowTargetState(popover, session, reason);
	if (enableLogging) {
		debugLog(session, "keepalive-hold", `Popover hold asserted (${reason})`, () =>
			summarizePopover(popover),
		);
	}
}

function releasePopoverControl(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	setPopoverFocused(popover, false);
	popover.onTarget = false;
	transitionSessionInteraction(session, { type: "interaction-reset" });
}

function patchCloseMethods(popover: HoverPopoverLike, state: PopoverPatchState): void {
	const { originals, ownerSession: session } = state;

	const wrapClose = (
		kind: string,
		getOriginal: () => ((...args: unknown[]) => unknown) | undefined,
	) => {
		return (...args: unknown[]) => {
			if (shouldBlockClose(popover, session, kind)) {
				restoreShownState(popover, session, `${kind}-blocked`);
				if (enableLogging) {
					debugLog(
						session,
						"close-blocked",
						`${kind}() was blocked by shadow keepalive`,
						() => ({
							kind,
							popover: summarizePopover(popover),
							session: summarizeSession(session),
						}),
					);
				}
				return;
			}
			const original = getOriginal();
			if (typeof original === "function") {
				return original.apply(popover, args);
			}
		};
	};

	if (typeof originals.hide === "function") {
		const patchedHide = wrapClose("hide", () => originals.hide);
		popover.hide = patchedHide;
		state.dispose = withPatchedMethod(
			state.dispose,
			popover,
			"hide",
			patchedHide,
			originals.hide,
		);
	}
	if (typeof originals.close === "function") {
		const patchedClose = wrapClose("close", () => originals.close);
		popover.close = patchedClose;
		state.dispose = withPatchedMethod(
			state.dispose,
			popover,
			"close",
			patchedClose,
			originals.close,
		);
	}
	if (typeof originals.unload === "function") {
		const patchedUnload = wrapClose("unload", () => originals.unload);
		popover.unload = patchedUnload;
		state.dispose = withPatchedMethod(
			state.dispose,
			popover,
			"unload",
			patchedUnload,
			originals.unload,
		);
	}
}

function patchDetect(popover: HoverPopoverLike, state: PopoverPatchState): void {
	const { originals, ownerSession: session } = state;
	const patchedDetect = function patchedDetect(
		this: HoverPopoverLike,
		...args: unknown[]
	) {
		const next = originals.detect;
		if (typeof next === "function") {
			next.apply(this, args);
		}
		syncShadowTargetState(this, session, "detect");
	};
	popover.detect = patchedDetect;
	state.dispose = withPatchedMethod(
		state.dispose,
		popover,
		"detect",
		patchedDetect,
		originals.detect,
	);
}

function patchTransition(popover: HoverPopoverLike, state: PopoverPatchState): void {
	const { originals, ownerSession: session } = state;
	if (typeof originals.transition !== "function") {
		return;
	}
	const patchedTransition = function patchedTransition(
		this: HoverPopoverLike,
		...args: unknown[]
	) {
		syncShadowTargetState(this, session, "transition");
		const next = originals.transition;
		if (typeof next === "function") {
			return next.apply(this, args);
		}
	};
	popover.transition = patchedTransition;
	state.dispose = withPatchedMethod(
		state.dispose,
		popover,
		"transition",
		patchedTransition,
		originals.transition,
	);
}

export function createShadowHoverSession(
	anchorRegistry: ShadowAnchorRegistry,
): ShadowHoverSession {
	const session: ShadowHoverSession = {
		anchorRegistry,
		state: createInitialHoverSessionState(),
		interaction: createInitialHoverSessionInteractionState(),
		allowClose: false,
		attachedPopoverEl: null,
		teardownPopoverListeners: null,
		teardownInteractionListeners: null,
		shownStateValue: null,
		lastHoverPath: null,
		handoffTimer: null,
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
				scheduleUnsafePopoverClose(stalePopover);
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
			if (session.shownStateValue == null) {
				session.shownStateValue = nextPopover.state ?? 1;
			}
			bindPopoverAnchor(nextPopover, requestAnchorEl, requestActualAnchorEl);
			patchPopoverInstance(
				nextPopover,
				session,
				requestAnchorEl,
				requestActualAnchorEl,
			);
			scheduleAttachPopoverHoverListeners(nextPopover, session);
			syncPopoverKeepAlive(session, "hoverParent-set");
			if (
				handoff &&
				handoff.requestSeq === requestSeq &&
				handoff.fromPopover !== nextPopover
			) {
				if (enableLogging) {
					debugLog(
						session,
						"handoff-complete",
						"Closing replaced popover after new assignment",
						() => ({
							requestSeq,
							from: summarizePopover(handoff.fromPopover),
							to: summarizePopover(nextPopover),
						}),
					);
				}
				closeReplacedPopover(handoff.fromPopover, session);
				session.anchorRegistry.releaseActual(handoff.fromActualAnchor);
				clearPendingHandoffTimer(session);
			}
		},
	});
	return hoverParent;
}

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

export function patchPopoverInstance(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	proxyAnchorEl?: HTMLElement,
	actualAnchorEl?: HTMLElement,
): void {
	if (enableLogging) {
		debugLog(session, "popover-patch", "Patching popover instance", () =>
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
	const state = ensurePopoverPatchState(popover, session);
	patchCloseMethods(popover, state);
	patchPosition(popover, state);
	patchDetect(popover, state);
	patchTransition(popover, state);
}

function ensurePopoverPatchState(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): PopoverPatchState {
	const existingState = patchedPopovers.get(popover);
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

	const originals: PopoverPatchState["originals"] = {
		hide: typeof popover.hide === "function" ? popover.hide : undefined,
		close: typeof popover.close === "function" ? popover.close : undefined,
		unload: typeof popover.unload === "function" ? popover.unload : undefined,
		position: typeof popover.position === "function" ? popover.position : undefined,
		detect: typeof popover.detect === "function" ? popover.detect : undefined,
		transition:
			typeof popover.transition === "function" ? popover.transition : undefined,
	};
	const state: PopoverPatchState = {
		ownerSession: session,
		originals,
		dispose() {
			if (patchedPopovers.get(popover) === state) {
				patchedPopovers.delete(popover);
			}
		},
	};
	patchedPopovers.set(popover, state);
	return state;
}

function patchPosition(popover: HoverPopoverLike, state: PopoverPatchState): void {
	const { originals, ownerSession: session } = state;
	if (typeof originals.position !== "function") {
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
		const next = originals.position;
		if (typeof next === "function") {
			return next.apply(this, args);
		}
	};
	popover.position = patchedPosition;
	state.dispose = withPatchedMethod(
		state.dispose,
		popover,
		"position",
		patchedPosition,
		originals.position,
	);
}

function attachOutsideInteractionListeners(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	session.teardownInteractionListeners?.();
	const hoverEl = popover.hoverEl;
	const win = hoverEl?.ownerDocument?.defaultView ?? window;
	const markInteraction = (event: Event) => {
		if (
			isSessionDestroyed(session) ||
			getActiveSessionPopover(session) !== popover
		) {
			return;
		}
		const activeAnchor = getActiveSessionAnchor(session);
		const target = event.target;
		const insidePopover = isElementWithinPopover(popover, target);
		const isExplicitCloseBtn =
			isElementLike(target) && target.closest(".mod-close") !== null;
		const proxyAnchor =
			getBoundPopoverProxyAnchor(popover) ?? activeAnchor?.proxyEl;
		const actualAnchor =
			getBoundPopoverActualAnchor(popover) ?? activeAnchor?.actualEl;
		const insideActualAnchor =
			isHTMLElementLike(actualAnchor) && isNodeLike(target)
				? actualAnchor.contains(target)
				: false;
		const insideProxyAnchor =
			isHTMLElementLike(proxyAnchor) && isNodeLike(target)
				? proxyAnchor.contains(target)
				: false;

		const outsideOrClose =
			(!insidePopover && !insideActualAnchor && !insideProxyAnchor) ||
			isExplicitCloseBtn;
		transitionSessionInteraction(session, {
			type: "outside-interaction",
			until: outsideOrClose ? Date.now() + 120 : 0,
		});

		if (enableLogging) {
			debugLog(
				session,
				outsideOrClose ? "interaction-outside-or-close" : "interaction-inside",
				`Observed ${event.type} interaction`,
				() => ({
					outsideOrClose,
					target: isElementLike(target)
						? { tag: target.tagName, className: target.className }
						: String(target),
				}),
			);
		}
	};
	const events: Array<keyof WindowEventMap> = ["click", "contextmenu"];
	for (const type of events) {
		win.addEventListener(type, markInteraction, true);
	}
	session.teardownInteractionListeners = () => {
		for (const type of events) {
			win.removeEventListener(type, markInteraction, true);
		}
	};
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
		window.requestAnimationFrame(() =>
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
	session.teardownInteractionListeners?.();
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
		syncPopoverKeepAlive(session, type);
	};
	const onEnter = () => onSync("mouseenter");
	const onLeave = () => onSync("mouseleave");
	const onFocusIn = () => onSync("focusin");
	const onFocusOut = () => onSync("focusout");
	hoverEl.addEventListener("mouseenter", onEnter, true);
	hoverEl.addEventListener("mouseleave", onLeave, true);
	hoverEl.addEventListener("focusin", onFocusIn, true);
	hoverEl.addEventListener("focusout", onFocusOut, true);
	attachOutsideInteractionListeners(popover, session);
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

export function syncPopoverKeepAlive(
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
				"keepalive-transition",
				`Re-evaluating popover transition (${reason})`,
				() => summarizeSession(session),
			);
		}
		popover.transition();
	}
}

export function reallyClosePopover(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
	reason: HoverSessionCloseReason = "manual",
): void {
	if (enableLogging) {
		debugLog(session, "close-run", "Running real popover close", () => ({
			popover: summarizePopover(popover),
			session: summarizeSession(session),
		}));
	}
	const hoverParent = getSessionPopoverHoverParent(session.state, popover);
	if (getPendingPopoverHandoff(session)?.fromPopover === popover) {
		clearPendingHandoffTimer(session);
	}
	transitionSession(session, { type: "close-start", popover, reason });
	clearPopoverInternalTimer(popover);
	const previousAllowClose = session.allowClose;
	session.allowClose = true;
	transitionSessionInteraction(session, {
		type: "outside-interaction",
		until: 0,
	});
	releasePopoverControl(popover, session);
	const actualAnchor = getBoundPopoverActualAnchor(popover);
	try {
		if (!callOriginalClose(popover)) {
			closePopoverUnsafe(popover);
		}
	} finally {
		session.allowClose = previousAllowClose;
		disposePopoverPatch(popover, session);
		if (hoverParent?.hoverPopover === popover) {
			hoverParent.hoverPopover = null;
		}
		transitionSession(session, { type: "close-finish", popover });
		if (actualAnchor) {
			session.anchorRegistry.releaseActual(actualAnchor);
		}
	}
}

export function closeReplacedPopover(
	popover: HoverPopoverLike,
	session: ShadowHoverSession,
): void {
	if (enableLogging) {
		debugLog(
			session,
			"close-replaced",
			"Closing replaced popover after handoff",
			() => ({
				popover: summarizePopover(popover),
				session: summarizeSession(session),
			}),
		);
	}
	clearPopoverInternalTimer(popover);
	const previousAllowClose = session.allowClose;
	session.allowClose = true;
	try {
		popover.onTarget = false;
		setPopoverFocused(popover, false);
		if (!callOriginalClose(popover)) {
			closePopoverUnsafe(popover);
		}
	} finally {
		session.allowClose = previousAllowClose;
		disposePopoverPatch(popover, session);
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
		window.clearTimeout(session.handoffTimer);
		session.handoffTimer = null;
	}
}

export function clearPopoverInternalTimer(popover: HoverPopoverLike): void {
	if (typeof popover.timer === "number") {
		window.clearTimeout(popover.timer);
		popover.timer = 0;
	}
}
