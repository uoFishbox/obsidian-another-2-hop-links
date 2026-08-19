import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ShadowHoverControllerImpl,
	type ShadowPopoverLaunchRequest,
} from "../controller";
import type { HoverPopoverLike } from "../internal-types";
import { createRequestHoverParent, syncProxyRectForActual } from "../session";

describe("ShadowHoverControllerImpl", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("launches on delegated enter and cleans up on destroy", () => {
		const launch = vi.fn();
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl(launch, resolveLink);
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);

		expect(launch).toHaveBeenCalledTimes(1);
		expect(resolveLink).toHaveBeenCalledWith("item:first");

		controller.destroy();

		expect(launch).toHaveBeenCalledTimes(1);
		expect(resolveLink).toHaveBeenCalledTimes(1);
	});

	it("relays delegated anchor enter and leave to the geometry proxy", () => {
		const controller = new ShadowHoverControllerImpl(vi.fn(), () => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const anchorEl = createAnchor();
		const session = controller.getDebugSession();
		const proxy = syncProxyRectForActual(session, anchorEl);
		const onEnter = vi.fn();
		const onLeave = vi.fn();
		proxy.addEventListener("mouseover", onEnter);
		proxy.addEventListener("mouseout", onLeave);

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedLeave(anchorEl);

		expect(onEnter).toHaveBeenCalledTimes(1);
		expect(onLeave).toHaveBeenCalledTimes(1);
		controller.destroy();
	});

	it("releases an accepted focused popover on destroy without forcing close", () => {
		const hide = vi.fn();
		const nativeTransition = vi.fn(function (this: HoverPopoverLike) {
			if (!this.onTarget && !this.isFocused) {
				this.hide?.();
			}
		});
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			hide,
			isFocused: true,
			transition: nativeTransition,
		};
		document.body.append(popover.hoverEl!);
		const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
			createRequestHoverParent(
				request.session,
				request.requestSeq,
				request.proxyAnchorEl,
				request.actualAnchorEl,
			).hoverPopover = popover;
		});
		const controller = new ShadowHoverControllerImpl(launch, () => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.destroy();

		expect(hide).not.toHaveBeenCalled();
		expect(nativeTransition).toHaveBeenCalledTimes(2);
		expect(popover.onTarget).toBe(false);
		expect(popover.isFocused).toBe(true);
		expect(popover.transition).toBe(nativeTransition);
		expect(controller.getDebugPopover()).toBeNull();
	});

	it("relaunches when the bridge forwards an armed modifier pointermove", () => {
		const launch = vi.fn();
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl(launch, resolveLink);
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedPointerMove(
			anchorEl,
			"item:first",
			new PointerEvent("pointermove", {
				bubbles: true,
				ctrlKey: true,
			}),
		);

		expect(launch).toHaveBeenCalledTimes(2);
		expect(resolveLink).toHaveBeenCalledTimes(2);
	});

	it("relaunches on delegated modifier key retriggers", () => {
		const launch = vi.fn();
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl(launch, resolveLink);
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedModifierKey(
			anchorEl,
			"item:first",
			new KeyboardEvent("keydown", {
				bubbles: true,
				ctrlKey: true,
				key: "Control",
			}),
		);

		expect(launch).toHaveBeenCalledTimes(2);
		expect(resolveLink).toHaveBeenCalledTimes(2);
		expect(launch.mock.calls[1]?.[0]?.event).toBeInstanceOf(MouseEvent);
	});

	it("syncs the active anchor without relaunching when the DOM node is replaced", () => {
		const launch = vi.fn();
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl(launch, resolveLink);
		const firstAnchorEl = createAnchor();
		const secondAnchorEl = createAnchor();

		controller.handleDelegatedEnter(
			firstAnchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		launch.mockClear();
		resolveLink.mockClear();

		controller.handleDelegatedAnchorSync(secondAnchorEl);

		expect(launch).not.toHaveBeenCalled();
		expect(resolveLink).not.toHaveBeenCalled();
	});

	it("relays leave and enter when the active anchor node is replaced", () => {
		const controller = new ShadowHoverControllerImpl(vi.fn(), () => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const firstAnchorEl = createAnchor(10);
		const secondAnchorEl = createAnchor(80);
		const session = controller.getDebugSession();
		const firstProxy = syncProxyRectForActual(session, firstAnchorEl);
		const secondProxy = syncProxyRectForActual(session, secondAnchorEl);
		const onFirstLeave = vi.fn();
		const onSecondEnter = vi.fn();
		firstProxy.addEventListener("mouseout", onFirstLeave);
		secondProxy.addEventListener("mouseover", onSecondEnter);

		controller.handleDelegatedEnter(
			firstAnchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedAnchorSync(secondAnchorEl);

		expect(onFirstLeave).toHaveBeenCalledTimes(1);
		expect(onSecondEnter).toHaveBeenCalledTimes(1);
		controller.destroy();
	});

	it("releases the old accepted popover before relaunching a replaced anchor", () => {
		const hideA = vi.fn();
		const onTargetValuesA: Array<boolean | undefined> = [];
		const transitionA = vi.fn(function (this: HoverPopoverLike) {
			onTargetValuesA.push(this.onTarget);
			if (!this.onTarget && !this.isFocused) {
				this.hide?.();
			}
		});
		const popoverA: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			hide: hideA,
			isFocused: true,
			transition: transitionA,
		};
		const popoverB: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			transition: vi.fn(),
		};
		document.body.append(popoverA.hoverEl!, popoverB.hoverEl!);
		const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
			createRequestHoverParent(
				request.session,
				request.requestSeq,
				request.proxyAnchorEl,
				request.actualAnchorEl,
			).hoverPopover = request.requestSeq === 1 ? popoverA : popoverB;
		});
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl(launch, resolveLink);
		const firstAnchorEl = createAnchor(10);
		const replacementAnchorEl = createAnchor(80);

		controller.handleDelegatedEnter(
			firstAnchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedAnchorSync(replacementAnchorEl, "item:first");

		expect(launch).toHaveBeenCalledTimes(2);
		expect(hideA).not.toHaveBeenCalled();
		expect(onTargetValuesA.at(-1)).toBe(false);
		expect(popoverA.isFocused).toBe(true);
		expect(controller.getDebugPopover()).toBe(popoverB);
		controller.destroy();
	});

	it("relaunches from anchor sync when the active anchor has no live popover", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(0);
			const launch = vi.fn();
			const resolveLink = vi.fn(() => ({
				linktext: "note",
				sourcePath: "note.md",
			}));
			const controller = new ShadowHoverControllerImpl(launch, resolveLink);
			const anchorEl = createAnchor();

			controller.handleDelegatedEnter(
				anchorEl,
				"item:first",
				new MouseEvent("mouseover", { bubbles: true }),
			);
			controller.handleDelegatedAnchorSync(anchorEl, "item:first");

			expect(launch).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(650);
			controller.handleDelegatedAnchorSync(anchorEl, "item:first");

			expect(launch).toHaveBeenCalledTimes(2);
			expect(resolveLink).toHaveBeenCalledTimes(2);
			controller.destroy();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not relaunch from anchor sync while a live popover is assigned", () => {
		const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
			createRequestHoverParent(
				request.session,
				request.requestSeq,
				request.proxyAnchorEl,
				request.actualAnchorEl,
			).hoverPopover = {
				hoverEl: document.createElement("div"),
				hide: vi.fn(),
				state: 1,
			};
		});
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl(launch, resolveLink);
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedAnchorSync(anchorEl, "item:first");

		expect(launch).toHaveBeenCalledTimes(1);
		expect(resolveLink).toHaveBeenCalledTimes(1);
		controller.destroy();
	});

	it("keeps a hovered popover alive when the delegated anchor is released", () => {
		const originalHide = vi.fn();
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			onHover: true,
			hide: originalHide,
			state: 1,
			transition() {
				if (!popover.onTarget && !popover.onHover && !popover.isFocused) {
					popover.hide?.();
				}
			},
		};
		document.body.append(popover.hoverEl!);
		const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
			createRequestHoverParent(
				request.session,
				request.requestSeq,
				request.proxyAnchorEl,
				request.actualAnchorEl,
			).hoverPopover = popover;
		});
		const controller = new ShadowHoverControllerImpl(launch, () => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedLeave(anchorEl);

		expect(originalHide).not.toHaveBeenCalled();
		controller.destroy();
	});

	it("allows an unhovered popover to close when the delegated anchor is released", () => {
		const originalHide = vi.fn();
		const popover: HoverPopoverLike = {
			hoverEl: document.createElement("div"),
			onHover: false,
			hide: originalHide,
			state: 1,
			transition() {
				if (!popover.onTarget && !popover.onHover && !popover.isFocused) {
					popover.hide?.();
				}
			},
		};
		document.body.append(popover.hoverEl!);
		const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
			createRequestHoverParent(
				request.session,
				request.requestSeq,
				request.proxyAnchorEl,
				request.actualAnchorEl,
			).hoverPopover = popover;
		});
		const controller = new ShadowHoverControllerImpl(launch, () => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		controller.handleDelegatedLeave(anchorEl);

		expect(originalHide).toHaveBeenCalledTimes(1);
		controller.destroy();
	});

	it("releases a focused handoff popover on timeout without forcing close", () => {
		vi.useFakeTimers();
		try {
			const hide = vi.fn();
			const onTargetValues: Array<boolean | undefined> = [];
			const nativeTransition = vi.fn(function (this: HoverPopoverLike) {
				onTargetValues.push(this.onTarget);
				if (!this.onTarget && !this.isFocused) {
					this.hide?.();
				}
			});
			const popover: HoverPopoverLike = {
				hoverEl: document.createElement("div"),
				hide,
				isFocused: true,
				state: 1,
				transition: nativeTransition,
			};
			const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
				if (request.requestSeq !== 1) {
					return;
				}
				createRequestHoverParent(
					request.session,
					request.requestSeq,
					request.proxyAnchorEl,
					request.actualAnchorEl,
				).hoverPopover = popover;
			});
			const resolveLink = vi.fn(() => ({
				linktext: "note",
				sourcePath: "note.md",
			}));
			const controller = new ShadowHoverControllerImpl(launch, resolveLink);
			const firstAnchorEl = createAnchor(10);
			const secondAnchorEl = createAnchor(80);

			controller.handleDelegatedEnter(
				firstAnchorEl,
				"item:first",
				new MouseEvent("mouseover", { bubbles: true, ctrlKey: true }),
			);
			controller.handleDelegatedEnter(
				secondAnchorEl,
				"item:second",
				new MouseEvent("mouseover", { bubbles: true, ctrlKey: true }),
			);

			expect(hide).not.toHaveBeenCalled();

			vi.advanceTimersByTime(600);

			expect(hide).not.toHaveBeenCalled();
			expect(nativeTransition).toHaveBeenCalledTimes(3);
			expect(onTargetValues.at(-1)).toBe(false);
			expect(popover.onTarget).toBe(false);
			expect(popover.isFocused).toBe(true);
			expect(controller.getDebugPopover()).toBeNull();
			controller.destroy();
		} finally {
			vi.useRealTimers();
		}
	});
});

function createAnchor(left = 10): HTMLButtonElement {
	const host = document.createElement("div");
	document.body.append(host);
	const shadowRoot = host.attachShadow({ mode: "open" });
	const anchorEl = document.createElement("button");
	Object.defineProperty(anchorEl, "getBoundingClientRect", {
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
	shadowRoot.append(anchorEl);
	return anchorEl;
}
