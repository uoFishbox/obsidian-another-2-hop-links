import { afterEach, describe, expect, it, vi } from "vitest";
import { ShadowHoverControllerImpl } from "../controller";
import type { ShadowPopoverLaunchRequest } from "../launcher";
import { createRequestHoverParent } from "../session";

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
		const controller = new ShadowHoverControllerImpl({ launch }, resolveLink);
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

	it("relaunches on modifier-key pointermove transitions through delegated handlers", () => {
		const launch = vi.fn();
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl({ launch }, resolveLink);
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
				ctrlKey: false,
			}),
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
		const controller = new ShadowHoverControllerImpl({ launch }, resolveLink);
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
		const controller = new ShadowHoverControllerImpl({ launch }, resolveLink);
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

	it("relaunches from anchor sync when the active anchor has no live popover", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(0);
			const launch = vi.fn();
			const resolveLink = vi.fn(() => ({
				linktext: "note",
				sourcePath: "note.md",
			}));
			const controller = new ShadowHoverControllerImpl(
				{ launch },
				resolveLink,
			);
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
		const controller = new ShadowHoverControllerImpl({ launch }, resolveLink);
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

	it("does not relaunch on steady-state pointermove", () => {
		const launch = vi.fn();
		const resolveLink = vi.fn(() => ({
			linktext: "note",
			sourcePath: "note.md",
		}));
		const controller = new ShadowHoverControllerImpl({ launch }, resolveLink);
		const anchorEl = createAnchor();

		controller.handleDelegatedEnter(
			anchorEl,
			"item:first",
			new MouseEvent("mouseover", { bubbles: true }),
		);
		launch.mockClear();
		resolveLink.mockClear();

		controller.handleDelegatedPointerMove(
			anchorEl,
			"item:first",
			new PointerEvent("pointermove", {
				bubbles: true,
				ctrlKey: false,
			}),
		);

		expect(launch).not.toHaveBeenCalled();
		expect(resolveLink).not.toHaveBeenCalled();
	});

	it("keeps the old popover during handoff and closes it on timeout when replacement is not assigned", () => {
		vi.useFakeTimers();
		try {
			const hide = vi.fn();
			const launch = vi.fn((request: ShadowPopoverLaunchRequest) => {
				if (request.requestSeq !== 1) {
					return;
				}
				createRequestHoverParent(
					request.session,
					request.requestSeq,
					request.proxyAnchorEl,
					request.actualAnchorEl,
				).hoverPopover = {
					hoverEl: document.createElement("div"),
					hide,
					state: 1,
				};
			});
			const resolveLink = vi.fn(() => ({
				linktext: "note",
				sourcePath: "note.md",
			}));
			const controller = new ShadowHoverControllerImpl(
				{ launch },
				resolveLink,
			);
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

			expect(hide).toHaveBeenCalledTimes(1);
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
