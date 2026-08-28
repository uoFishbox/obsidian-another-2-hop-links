import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	beginSessionHandoff,
	beginSessionRequest,
	createRequestHoverParent,
	createShadowHoverSession,
	getActiveSessionHoverParent,
	getActiveSessionPopover,
	getBoundPopoverActualAnchor,
	getBoundPopoverAnchor,
	getPendingPopoverHandoff,
	isActualHovered,
	relayHoverToProxy,
	releasePopoverToNativeLifecycle,
	setAnchorHovered,
	syncPopoverTargetAndTransition,
	syncProxyRectForActual,
} from "../session";
import type { HoverPopoverLike, ShadowHoverSession } from "../internal-types";

describe("createRequestHoverParent", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("defers stale popover cleanup so hover-editor can finish registering listeners", async () => {
		const session = createShadowHoverSession();
		const requestAnchorEl = document.createElement("button");
		const activeAnchorEl = document.createElement("button");
		beginRequest(session, activeAnchorEl, activeAnchorEl, 2);

		const hoverParent = createRequestHoverParent(session, 1, requestAnchorEl);
		const abortController = { register: vi.fn() };
		const popover = {
			abortController,
			hide() {
				this.abortController = undefined as unknown as typeof abortController;
			},
		};

		hoverParent.hoverPopover = popover;

		expect(popover.abortController).toBe(abortController);

		await Promise.resolve();

		expect(popover.abortController).toBeUndefined();
	});

	it("clears the session popover when the assigned popover is removed", () => {
		const session = createShadowHoverSession();
		const requestAnchorEl = document.createElement("button");
		beginRequest(session, requestAnchorEl, requestAnchorEl, 1);

		const hoverParent = createRequestHoverParent(session, 1, requestAnchorEl);
		const popover = { state: 1 };

		hoverParent.hoverPopover = popover;
		expect(getActiveSessionPopover(session)).toBe(popover);

		hoverParent.hoverPopover = null;

		expect(getActiveSessionPopover(session)).toBeNull();
		expect(getActiveSessionHoverParent(session)).toBeNull();
	});

	it("does not clear another hoverParent's popover when this one is removed", () => {
		const session = createShadowHoverSession();
		const requestAnchorElA = document.createElement("button");
		const requestAnchorElB = document.createElement("button");
		beginRequest(session, requestAnchorElB, requestAnchorElB, 2);

		const hoverParentA = createRequestHoverParent(session, 1, requestAnchorElA);
		const hoverParentB = createRequestHoverParent(session, 2, requestAnchorElB);
		const popoverB = { state: 2 };

		hoverParentB.hoverPopover = popoverB;
		expect(getActiveSessionPopover(session)).toBe(popoverB);
		expect(getActiveSessionHoverParent(session)).toBe(hoverParentB);

		hoverParentA.hoverPopover = null;

		expect(getActiveSessionPopover(session)).toBe(popoverB);
		expect(getActiveSessionHoverParent(session)).toBe(hoverParentB);
	});

	it("relays proxy enter after accepted assignment listeners can finish registering", async () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);
		const popover = { transition: vi.fn() };
		const hoverParent = createRequestHoverParent(
			session,
			1,
			proxyAnchor,
			actualAnchor,
		);

		hoverParent.hoverPopover = popover;
		const onProxyEnter = vi.fn();
		proxyAnchor.addEventListener("mouseover", onProxyEnter);

		expect(onProxyEnter).not.toHaveBeenCalled();
		await Promise.resolve();

		expect(onProxyEnter).toHaveBeenCalledTimes(1);
	});

	it("skips deferred proxy enter after the actual anchor has been left", async () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);
		const hoverParent = createRequestHoverParent(
			session,
			1,
			proxyAnchor,
			actualAnchor,
		);

		hoverParent.hoverPopover = { transition: vi.fn() };
		const onProxyEnter = vi.fn();
		proxyAnchor.addEventListener("mouseover", onProxyEnter);
		setAnchorHovered(session, actualAnchor, false);
		await Promise.resolve();

		expect(onProxyEnter).not.toHaveBeenCalled();
	});

	it("keeps popover ownership bound to the original actual anchor when another proxy is synced", () => {
		const session = createShadowHoverSession();
		const actualAnchorA = createMeasuredButton(10);
		const actualAnchorB = createMeasuredButton(80);
		const proxyAnchorA = syncProxyRectForActual(session, actualAnchorA);
		beginRequest(session, actualAnchorA, proxyAnchorA, 1);
		setAnchorHovered(session, actualAnchorA, true);

		const originalHide = vi.fn();
		const popover = {
			hoverEl: document.createElement("div"),
			onHover: false,
			hide: originalHide,
			state: 1,
		};
		document.body.append(popover.hoverEl);

		const hoverParent = createRequestHoverParent(
			session,
			1,
			proxyAnchorA,
			actualAnchorA,
		);
		hoverParent.hoverPopover = popover;

		expect(getBoundPopoverAnchor(popover)).toBe(proxyAnchorA);
		expect(getBoundPopoverActualAnchor(popover)).toBe(actualAnchorA);

		setAnchorHovered(session, actualAnchorA, false);
		setAnchorHovered(session, actualAnchorB, true);
		const proxyAnchorB = syncProxyRectForActual(session, actualAnchorB);
		syncPopoverTargetAndTransition(session);

		popover.hide();

		expect(proxyAnchorB).not.toBe(proxyAnchorA);
		expect(getBoundPopoverAnchor(popover)).toBe(proxyAnchorA);
		expect(originalHide).toHaveBeenCalledTimes(1);
		expect(session.overAnchor).toBe(false);
	});

	it("releases a pending handoff popover to native lifecycle after replacement", () => {
		const session = createShadowHoverSession();
		const actualAnchorA = createMeasuredButton(10);
		const actualAnchorB = createMeasuredButton(80);
		const proxyAnchorA = syncProxyRectForActual(session, actualAnchorA);
		const proxyAnchorB = syncProxyRectForActual(session, actualAnchorB);
		const hideA = vi.fn();
		const hideB = vi.fn();
		const transitionA = vi.fn(function (this: HoverPopoverLike) {
			if (!this.onTarget && !this.isFocused) {
				this.hide?.();
			}
		});
		const popoverA: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			hide: hideA,
			isFocused: true,
			state: 1,
			transition: transitionA,
		};
		const popoverB = {
			hoverEl: document.createElement("div"),
			hide: hideB,
			state: 1,
		};
		document.body.append(popoverA.hoverEl!, popoverB.hoverEl);

		beginRequest(session, actualAnchorA, proxyAnchorA, 1);
		setAnchorHovered(session, actualAnchorA, true);
		createRequestHoverParent(session, 1, proxyAnchorA, actualAnchorA).hoverPopover =
			popoverA;

		setAnchorHovered(session, actualAnchorB, true);
		beginSessionHandoff(session, {
			fromPopover: popoverA,
			fromHoverParent: getActiveSessionHoverParent(session),
			fromAnchor: { actualEl: actualAnchorA, proxyEl: proxyAnchorA },
			toAnchor: { actualEl: actualAnchorB, proxyEl: proxyAnchorB },
			requestSeq: 2,
		});
		session.handoffTimer = window.setTimeout(() => {}, 600);

		expect(hideA).not.toHaveBeenCalled();

		createRequestHoverParent(session, 2, proxyAnchorB, actualAnchorB).hoverPopover =
			popoverB;

		expect(hideA).not.toHaveBeenCalled();
		expect(hideB).not.toHaveBeenCalled();
		expect(transitionA).toHaveBeenCalledTimes(2);
		expect(popoverA.onTarget).toBe(false);
		expect(popoverA.isFocused).toBe(true);
		expect(getBoundPopoverActualAnchor(popoverA)).toBeNull();
		expect(proxyAnchorA.isConnected).toBe(false);
		expect(getActiveSessionPopover(session)).toBe(popoverB);
		expect(getPendingPopoverHandoff(session)).toBeNull();
		expect(isActualHovered(session, actualAnchorA)).toBe(false);
		expect(isActualHovered(session, actualAnchorB)).toBe(true);
	});

	it("clears hover state when syncing a detached actual anchor", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		setAnchorHovered(session, actualAnchor, true);

		actualAnchor.remove();
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);

		expect(isActualHovered(session, actualAnchor)).toBe(false);
		expect(proxyAnchor.style.left).toBe("0px");
		expect(proxyAnchor.style.top).toBe("0px");
		expect(proxyAnchor.style.width).toBe("0px");
		expect(proxyAnchor.style.height).toBe("0px");
	});

	it("does not keep a popover alive for a detached hovered actual anchor", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const originalHide = vi.fn();
		const popover = {
			hoverEl: document.createElement("div"),
			onHover: false,
			hide: originalHide,
			state: 1,
		};
		document.body.append(popover.hoverEl);

		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;

		actualAnchor.remove();
		syncPopoverTargetAndTransition(session);
		popover.hide();

		expect(originalHide).toHaveBeenCalledTimes(1);
		expect(session.overAnchor).toBe(false);
		expect(isActualHovered(session, actualAnchor)).toBe(false);
	});

	it("guards close methods while preserving native transition and detect", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const hide = vi.fn();
		const close = vi.fn();
		const unload = vi.fn();
		const detect = vi.fn();
		const position = vi.fn();
		const transition = vi.fn();
		const nativeState = { type: "plugin-owned" };
		const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
		const popover = {
			hoverEl: document.createElement("div"),
			hide,
			close,
			unload,
			detect,
			position,
			transition,
			state: nativeState,
			timer: 123,
		};
		document.body.append(popover.hoverEl);

		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;

		expect(popover.hide).not.toBe(hide);
		expect(popover.close).not.toBe(close);
		expect(popover.unload).not.toBe(unload);
		expect(popover.detect).toBe(detect);
		expect(popover.position).not.toBe(position);
		expect(popover.transition).toBe(transition);
		expect(popover.state).toBe(nativeState);
		expect(popover.timer).toBe(123);

		setMeasuredButtonRect(actualAnchor, 80);
		popover.position();

		const closingState = { type: "closing" };
		popover.state = closingState;
		popover.timer = 123;
		popover.hide();
		popover.close();
		popover.unload();

		expect(hide).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(unload).not.toHaveBeenCalled();
		expect(position).toHaveBeenCalledTimes(1);
		expect(proxyAnchor.style.left).toBe("80px");
		expect(popover.state).toBe(nativeState);
		expect(popover.timer).toBe(0);
		expect(clearTimeoutSpy).toHaveBeenCalledWith(123);

		releasePopoverToNativeLifecycle(popover, session);

		expect(popover.hide).toBe(hide);
		expect(popover.close).toBe(close);
		expect(popover.unload).toBe(unload);
		expect(popover.detect).toBe(detect);
		expect(popover.transition).toBe(transition);
	});

	it("allows an active unpinned Hover Editor popover to close after pointer leave", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const hoverEl = document.createElement("div");
		hoverEl.className = "popover hover-popover hover-editor is-active";
		const editor = document.createElement("textarea");
		hoverEl.append(editor);
		document.body.append(hoverEl);
		const hide = vi.fn();
		const popover: HoverPopoverLike = {
			hoverEl,
			hide,
			isPinned: false,
			onHover: false,
			shouldShowSelf() {
				return Boolean(this.onTarget || this.onHover || this.isPinned);
			},
			state: 1,
			transition: vi.fn(),
		};
		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;
		editor.focus();
		setAnchorHovered(session, actualAnchor, false);

		popover.hide?.();

		expect(document.activeElement).toBe(editor);
		expect(session.overAnchor).toBe(false);
		expect(session.overPopover).toBe(false);
		expect(hide).toHaveBeenCalledTimes(1);
		expect(popover.hide).toBe(hide);
	});

	it("lets a standard popover's native transition retain focused content", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const hoverEl = document.createElement("div");
		const focusTarget = document.createElement("button");
		hoverEl.append(focusTarget);
		document.body.append(hoverEl);
		const hide = vi.fn();
		const shouldShowSelf = vi.fn(() => hoverEl.contains(document.activeElement));
		const popover: HoverPopoverLike = {
			hoverEl,
			hide,
			onHover: false,
			shouldShowSelf,
			state: 1,
			transition() {
				if (!this.shouldShowSelf?.()) this.hide?.();
			},
		};
		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;
		focusTarget.focus();
		setAnchorHovered(session, actualAnchor, false);

		syncPopoverTargetAndTransition(session);

		expect(session.overAnchor).toBe(false);
		expect(session.overPopover).toBe(false);
		expect(shouldShowSelf).toHaveBeenCalled();
		expect(hide).not.toHaveBeenCalled();
		expect(popover.hide).not.toBe(hide);
	});

	it("allows Hover Editor to hide an empty window while its pointer remains active", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const hoverEl = document.createElement("div");
		hoverEl.className = "popover hover-popover hover-editor is-active";
		document.body.append(hoverEl);
		const hide = vi.fn();
		const shouldShowSelf = vi.fn(() => true);
		const popover: HoverPopoverLike = {
			hoverEl,
			hide,
			isPinned: false,
			onHover: true,
			shouldShowSelf,
			state: 1,
			transition: vi.fn(),
		};
		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;
		setAnchorHovered(session, actualAnchor, false);

		const leaves: unknown[] = [];
		if (leaves.length === 0) popover.hide?.();

		expect(session.overAnchor).toBe(false);
		expect(session.overPopover).toBe(true);
		expect(shouldShowSelf).not.toHaveBeenCalled();
		expect(hide).toHaveBeenCalledTimes(1);
		expect(popover.hide).toBe(hide);
	});

	it("releases a Hover Editor popover to native lifecycle when it becomes pinned", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const hide = vi.fn();
		const position = vi.fn();
		const transition = vi.fn();
		const togglePin = vi.fn(function (this: HoverPopoverLike, pinned?: boolean) {
			this.isPinned = pinned ?? !this.isPinned;
		});
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			hide,
			isPinned: false,
			position,
			state: 1,
			togglePin,
			transition,
		};
		document.body.append(popover.hoverEl!);
		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;

		expect(popover.togglePin).not.toBe(togglePin);
		expect(popover.hide).not.toBe(hide);
		expect(popover.position).not.toBe(position);

		popover.togglePin?.(true);

		expect(togglePin).toHaveBeenCalledWith(true);
		expect(popover.isPinned).toBe(true);
		expect(popover.togglePin).toBe(togglePin);
		expect(popover.hide).toBe(hide);
		expect(popover.position).toBe(position);
		expect(getActiveSessionPopover(session)).toBeNull();
		expect(getActiveSessionHoverParent(session)).toBeNull();
		expect(getBoundPopoverActualAnchor(popover)).toBeNull();
		expect(proxyAnchor.isConnected).toBe(false);
		expect(hide).not.toHaveBeenCalled();
		expect(transition).toHaveBeenCalledTimes(2);
	});

	it("keeps bridge ownership when Hover Editor remains unpinned", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const togglePin = vi.fn(function (this: HoverPopoverLike, pinned?: boolean) {
			this.isPinned = pinned ?? !this.isPinned;
		});
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			isPinned: false,
			state: 1,
			togglePin,
			transition: vi.fn(),
		};
		document.body.append(popover.hoverEl!);
		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;

		popover.togglePin?.(false);

		expect(popover.isPinned).toBe(false);
		expect(popover.togglePin).not.toBe(togglePin);
		expect(getActiveSessionPopover(session)).toBe(popover);
		expect(getBoundPopoverActualAnchor(popover)).toBe(actualAnchor);
		expect(proxyAnchor.isConnected).toBe(true);
	});

	it("waits for Hover Editor to confirm an auto-pinned popover via togglePin", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const togglePin = vi.fn();
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			isPinned: true,
			state: 1,
			togglePin,
			transition: vi.fn(),
		};
		document.body.append(popover.hoverEl!);

		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;

		expect(popover.togglePin).not.toBe(togglePin);
		expect(getActiveSessionPopover(session)).toBe(popover);
		expect(getBoundPopoverActualAnchor(popover)).toBe(actualAnchor);
		expect(proxyAnchor.isConnected).toBe(true);

		popover.togglePin?.(true);

		expect(popover.togglePin).toBe(togglePin);
		expect(getActiveSessionPopover(session)).toBeNull();
		expect(getBoundPopoverActualAnchor(popover)).toBeNull();
		expect(proxyAnchor.isConnected).toBe(false);
	});

	it("allows an explicit popover close button to bypass the keep-alive guard", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const close = vi.fn();
		const hoverEl = document.createElement("div");
		const closeButton = document.createElement("button");
		closeButton.classList.add("mod-close");
		hoverEl.append(closeButton);
		const popover: HoverPopoverLike = {
			hoverEl,
			onHover: true,
			close,
			state: 1,
		};
		document.body.append(hoverEl);
		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;
		closeButton.addEventListener("click", () => popover.close?.());

		closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(close).toHaveBeenCalledTimes(1);
		expect(popover.close).toBe(close);
	});

	it("synchronizes onTarget at explicit bridge boundaries without wrapping transition", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);

		const onTargetValues: Array<boolean | undefined> = [];
		const transition = function (this: HoverPopoverLike) {
			onTargetValues.push(this.onTarget);
		};
		const popover = {
			hoverEl: document.createElement("div"),
			onTarget: false,
			transition,
		};
		document.body.append(popover.hoverEl);

		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;
		expect(popover.transition).toBe(transition);
		setAnchorHovered(session, actualAnchor, false);
		popover.transition();
		syncPopoverTargetAndTransition(session);

		expect(onTargetValues).toEqual([true, true, false]);
	});

	it("lets proxy listeners drive the unwrapped native transition", () => {
		const session = createShadowHoverSession();
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = syncProxyRectForActual(session, actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		setAnchorHovered(session, actualAnchor, true);
		const onTargetValues: Array<boolean | undefined> = [];
		const transition = function (this: HoverPopoverLike) {
			onTargetValues.push(this.onTarget);
		};
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			onTarget: false,
			transition,
		};
		document.body.append(popover.hoverEl!);

		createRequestHoverParent(session, 1, proxyAnchor, actualAnchor).hoverPopover =
			popover;
		proxyAnchor.addEventListener("mouseout", () => {
			popover.onTarget = false;
			popover.transition?.();
		});
		setAnchorHovered(session, actualAnchor, false);
		relayHoverToProxy(session, actualAnchor, false);

		expect(popover.transition).toBe(transition);
		expect(onTargetValues).toEqual([true, false]);
	});
});

function createMeasuredButton(left: number): HTMLButtonElement {
	const button = document.createElement("button");
	setMeasuredButtonRect(button, left);
	document.body.append(button);
	return button;
}

function setMeasuredButtonRect(button: HTMLButtonElement, left: number): void {
	Object.defineProperty(button, "getBoundingClientRect", {
		configurable: true,
		value: () =>
			({
				left,
				top: 12,
				width: 50,
				height: 24,
				right: left + 50,
				bottom: 36,
				x: left,
				y: 12,
				toJSON: () => ({}),
			}) as DOMRect,
	});
}

function beginRequest(
	session: ShadowHoverSession,
	actualEl: HTMLElement,
	proxyEl: HTMLElement,
	requestSeq: number,
): void {
	beginSessionRequest(session, { actualEl, proxyEl }, requestSeq);
}
