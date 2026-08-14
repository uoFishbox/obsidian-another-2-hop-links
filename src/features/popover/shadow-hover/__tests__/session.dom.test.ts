import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShadowAnchorRegistry } from "../registry";
import {
	createRequestHoverParent,
	createShadowHoverSession,
	getActiveSessionPopover,
	getBoundPopoverActualAnchor,
	getBoundPopoverAnchor,
	getPendingPopoverHandoff,
	syncSessionAnchor,
	syncPopoverTargetAndTransition,
	transitionSession,
} from "../session";
import { getSessionOpenPopover } from "../state-machine";
import type { HoverPopoverLike, ShadowHoverSession } from "../internal-types";

describe("createRequestHoverParent", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("defers stale popover cleanup so hover-editor can finish registering listeners", async () => {
		const session = createShadowHoverSession(new ShadowAnchorRegistry());
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
		const session = createShadowHoverSession(new ShadowAnchorRegistry());
		const requestAnchorEl = document.createElement("button");
		beginRequest(session, requestAnchorEl, requestAnchorEl, 1);

		const hoverParent = createRequestHoverParent(session, 1, requestAnchorEl);
		const popover = { state: 1 };

		hoverParent.hoverPopover = popover;
		expect(getActiveSessionPopover(session)).toBe(popover);

		hoverParent.hoverPopover = null;

		expect(getActiveSessionPopover(session)).toBeNull();
		expect(getSessionOpenPopover(session.state)).toBeNull();
	});

	it("does not clear another hoverParent's popover when this one is removed", () => {
		const session = createShadowHoverSession(new ShadowAnchorRegistry());
		const requestAnchorElA = document.createElement("button");
		const requestAnchorElB = document.createElement("button");
		beginRequest(session, requestAnchorElB, requestAnchorElB, 2);

		const hoverParentA = createRequestHoverParent(session, 1, requestAnchorElA);
		const hoverParentB = createRequestHoverParent(session, 2, requestAnchorElB);
		const popoverB = { state: 2 };

		hoverParentB.hoverPopover = popoverB;
		expect(getActiveSessionPopover(session)).toBe(popoverB);
		expect(getSessionOpenPopover(session.state)?.hoverParent).toBe(hoverParentB);

		hoverParentA.hoverPopover = null;

		expect(getActiveSessionPopover(session)).toBe(popoverB);
		expect(getSessionOpenPopover(session.state)?.hoverParent).toBe(hoverParentB);
	});

	it("relays proxy enter after accepted assignment listeners can finish registering", async () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		registry.setHovered(actualAnchor, true);
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
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		registry.setHovered(actualAnchor, true);
		const hoverParent = createRequestHoverParent(
			session,
			1,
			proxyAnchor,
			actualAnchor,
		);

		hoverParent.hoverPopover = { transition: vi.fn() };
		const onProxyEnter = vi.fn();
		proxyAnchor.addEventListener("mouseover", onProxyEnter);
		registry.setHovered(actualAnchor, false);
		await Promise.resolve();

		expect(onProxyEnter).not.toHaveBeenCalled();
	});

	it("keeps popover ownership bound to the original actual anchor when another proxy is synced", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchorA = createMeasuredButton(10);
		const actualAnchorB = createMeasuredButton(80);
		const proxyAnchorA = registry.syncProxyRectForActual(actualAnchorA);
		beginRequest(session, actualAnchorA, proxyAnchorA, 1);
		registry.setHovered(actualAnchorA, true);

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

		registry.setHovered(actualAnchorA, false);
		registry.setHovered(actualAnchorB, true);
		const proxyAnchorB = registry.syncProxyRectForActual(actualAnchorB);
		syncPopoverTargetAndTransition(session, "test-anchor-rebind");

		popover.hide();

		expect(proxyAnchorB).not.toBe(proxyAnchorA);
		expect(getBoundPopoverAnchor(popover)).toBe(proxyAnchorA);
		expect(originalHide).toHaveBeenCalledTimes(1);
		expect(session.interaction.overAnchor).toBe(false);
	});

	it("releases a pending handoff popover to native lifecycle after replacement", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchorA = createMeasuredButton(10);
		const actualAnchorB = createMeasuredButton(80);
		const proxyAnchorA = registry.syncProxyRectForActual(actualAnchorA);
		const proxyAnchorB = registry.syncProxyRectForActual(actualAnchorB);
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
		registry.setHovered(actualAnchorA, true);
		createRequestHoverParent(session, 1, proxyAnchorA, actualAnchorA).hoverPopover =
			popoverA;

		syncSessionAnchor(session, actualAnchorB, proxyAnchorB);
		registry.setHovered(actualAnchorB, true);
		transitionSession(session, {
			type: "handoff-start",
			fromPopover: popoverA,
			fromHoverParent: getSessionOpenPopover(session.state)?.hoverParent ?? null,
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
		expect(registry.isActualHovered(actualAnchorA)).toBe(false);
		expect(registry.isActualHovered(actualAnchorB)).toBe(true);
	});

	it("clears hover state when syncing a detached actual anchor", () => {
		const registry = new ShadowAnchorRegistry();
		const actualAnchor = createMeasuredButton(10);
		registry.setHovered(actualAnchor, true);

		actualAnchor.remove();
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);

		expect(registry.isActualHovered(actualAnchor)).toBe(false);
		expect(proxyAnchor.style.left).toBe("0px");
		expect(proxyAnchor.style.top).toBe("0px");
		expect(proxyAnchor.style.width).toBe("0px");
		expect(proxyAnchor.style.height).toBe("0px");
	});

	it("does not keep a popover alive for a detached hovered actual anchor", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		registry.setHovered(actualAnchor, true);

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
		syncPopoverTargetAndTransition(session, "test-anchor-detached");
		popover.hide();

		expect(originalHide).toHaveBeenCalledTimes(1);
		expect(session.interaction.overAnchor).toBe(false);
		expect(registry.isActualHovered(actualAnchor)).toBe(false);
	});

	it("patches only position while preserving native lifecycle methods and state", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		registry.setHovered(actualAnchor, true);

		const hide = vi.fn();
		const close = vi.fn();
		const unload = vi.fn();
		const detect = vi.fn();
		const position = vi.fn();
		const transition = vi.fn();
		const nativeState = { type: "plugin-owned" };
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

		expect(popover.hide).toBe(hide);
		expect(popover.close).toBe(close);
		expect(popover.unload).toBe(unload);
		expect(popover.detect).toBe(detect);
		expect(popover.position).not.toBe(position);
		expect(popover.transition).toBe(transition);
		expect(popover.state).toBe(nativeState);
		expect(popover.timer).toBe(123);

		setMeasuredButtonRect(actualAnchor, 80);
		popover.position();

		popover.hide();
		popover.close();
		popover.unload();

		expect(hide).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
		expect(unload).toHaveBeenCalledTimes(1);
		expect(position).toHaveBeenCalledTimes(1);
		expect(proxyAnchor.style.left).toBe("80px");
		expect(popover.state).toBe(nativeState);
		expect(popover.timer).toBe(123);
	});

	it("synchronizes onTarget at explicit bridge boundaries without wrapping transition", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		registry.setHovered(actualAnchor, true);

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
		registry.setHovered(actualAnchor, false);
		popover.transition();
		syncPopoverTargetAndTransition(session, "test-anchor-leave");

		expect(onTargetValues).toEqual([true, true, false]);
	});

	it("lets proxy listeners drive the unwrapped native transition", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchor = createMeasuredButton(10);
		const proxyAnchor = registry.syncProxyRectForActual(actualAnchor);
		beginRequest(session, actualAnchor, proxyAnchor, 1);
		registry.setHovered(actualAnchor, true);
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
		registry.setHovered(actualAnchor, false);
		registry.relayHoverToProxy(actualAnchor, false);

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
	syncSessionAnchor(session, actualEl, proxyEl);
	transitionSession(session, {
		type: "request-open",
		anchor: { actualEl, proxyEl },
		requestSeq,
	});
}
