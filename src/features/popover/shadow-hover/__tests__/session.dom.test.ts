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
	transitionSession,
} from "../session";
import { getSessionOpenPopover } from "../state-machine";
import type { ShadowHoverSession } from "../internal-types";

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

		popover.hide();

		expect(proxyAnchorB).not.toBe(proxyAnchorA);
		expect(getBoundPopoverAnchor(popover)).toBe(proxyAnchorA);
		expect(originalHide).toHaveBeenCalledTimes(1);
		expect(session.interaction.overAnchor).toBe(false);
	});

	it("closes a pending handoff popover only after the replacement is assigned", () => {
		const registry = new ShadowAnchorRegistry();
		const session = createShadowHoverSession(registry);
		const actualAnchorA = createMeasuredButton(10);
		const actualAnchorB = createMeasuredButton(80);
		const proxyAnchorA = registry.syncProxyRectForActual(actualAnchorA);
		const proxyAnchorB = registry.syncProxyRectForActual(actualAnchorB);
		const hideA = vi.fn();
		const hideB = vi.fn();
		const popoverA = {
			hoverEl: document.createElement("div"),
			hide: hideA,
			state: 1,
		};
		const popoverB = {
			hoverEl: document.createElement("div"),
			hide: hideB,
			state: 1,
		};
		document.body.append(popoverA.hoverEl, popoverB.hoverEl);

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

		expect(hideA).toHaveBeenCalledTimes(1);
		expect(hideB).not.toHaveBeenCalled();
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
		popover.hide();

		expect(originalHide).toHaveBeenCalledTimes(1);
		expect(session.interaction.overAnchor).toBe(false);
		expect(registry.isActualHovered(actualAnchor)).toBe(false);
	});
});

function createMeasuredButton(left: number): HTMLButtonElement {
	const button = document.createElement("button");
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
	document.body.append(button);
	return button;
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
