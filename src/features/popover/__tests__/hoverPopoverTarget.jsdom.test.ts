import { afterEach, describe, expect, it } from "vitest";
import {
	createHoverPreviewMouseEvent,
	deactivateShadowHoverPopoverProxyElement,
	getShadowHoverPopoverProxyElement,
	normalizeHoverPopoverTargetEl,
	resolveHoverPreviewTargetElement,
} from "../hoverPopoverTarget";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("hoverPopoverTarget", () => {
	it("creates a light DOM proxy for a shadow DOM element", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const target = document.createElement("div");
		target.getBoundingClientRect = () =>
			({
				left: 12,
				top: 34,
				width: 56,
				height: 78,
				right: 68,
				bottom: 112,
				x: 12,
				y: 34,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const proxy = normalizeHoverPopoverTargetEl(target) as HTMLDivElement;

		expect(proxy).not.toBe(target);
		expect(proxy.parentElement).toBe(document.body);
		expect(proxy.getAttribute("data-ccl-shadow-hover-proxy-active")).toBe("1");
		expect(getShadowHoverPopoverProxyElement(target)).toBe(proxy);
	});

	it("relays click and middle-mousedown from the active proxy back to the source element", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const target = document.createElement("button");
		target.getBoundingClientRect = () =>
			({
				left: 12,
				top: 34,
				width: 56,
				height: 78,
				right: 68,
				bottom: 112,
				x: 12,
				y: 34,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const proxy = normalizeHoverPopoverTargetEl(target) as HTMLDivElement;
		const relayedEvents: Array<{ type: string; button: number }> = [];
		target.addEventListener("mousedown", (event) => {
			relayedEvents.push({ type: event.type, button: event.button });
			if (event.button === 1) {
				event.preventDefault();
			}
		});
		target.addEventListener("click", (event) => {
			relayedEvents.push({ type: event.type, button: event.button });
		});

		const middleDown = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 1,
			buttons: 4,
		});
		proxy.dispatchEvent(middleDown);
		expect(middleDown.defaultPrevented).toBe(true);

		proxy.dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);

		expect(relayedEvents).toEqual([
			{ type: "mousedown", button: 1 },
			{ type: "click", button: 0 },
		]);
	});

	it("deactivates the shadow proxy without removing it", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const target = document.createElement("div");
		target.getBoundingClientRect = () =>
			({
				left: 20,
				top: 40,
				width: 60,
				height: 80,
				right: 80,
				bottom: 120,
				x: 20,
				y: 40,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const proxy = normalizeHoverPopoverTargetEl(target) as HTMLDivElement;
		expect(proxy.getAttribute("data-ccl-shadow-hover-proxy-active")).toBe("1");

		expect(deactivateShadowHoverPopoverProxyElement(target)).toBe(true);
		expect(proxy.getAttribute("data-ccl-shadow-hover-proxy-active")).toBeNull();
		expect(proxy.isConnected).toBe(true);
	});

	it("uses the event-resolved element when called with a ShadowRoot", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const target = document.createElement("button");
		target.getBoundingClientRect = () =>
			({
				left: 15,
				top: 25,
				width: 35,
				height: 45,
				right: 50,
				bottom: 70,
				x: 15,
				y: 25,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const event = new MouseEvent("mouseover", { bubbles: true });
		Object.defineProperty(event, "target", {
			value: target,
			configurable: true,
		});
		Object.defineProperty(event, "currentTarget", {
			value: target,
			configurable: true,
		});

		const normalized = normalizeHoverPopoverTargetEl(
			shadowRoot,
			event,
		) as HTMLDivElement;

		expect(normalized).not.toBe(host);
		expect(normalized.getAttribute("data-ccl-shadow-hover-proxy")).toBe("1");
	});

	it("removes proxies for detached source elements when queried again", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const target = document.createElement("div");
		target.getBoundingClientRect = () =>
			({
				left: 5,
				top: 6,
				width: 7,
				height: 8,
				right: 12,
				bottom: 14,
				x: 5,
				y: 6,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const proxy = normalizeHoverPopoverTargetEl(target) as HTMLDivElement;
		expect(proxy.isConnected).toBe(true);

		target.remove();

		expect(getShadowHoverPopoverProxyElement(target)).toBeNull();
		expect(proxy.isConnected).toBe(false);
	});

	it("uses the source element document for foreign-window shadow proxies", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		expect(foreignDocument).toBeTruthy();
		if (!foreignDocument) {
			return;
		}

		const host = foreignDocument.createElement("div");
		foreignDocument.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const target = foreignDocument.createElement("div");
		target.getBoundingClientRect = () =>
			({
				left: 9,
				top: 10,
				width: 11,
				height: 12,
				right: 20,
				bottom: 22,
				x: 9,
				y: 10,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const proxy = normalizeHoverPopoverTargetEl(target) as HTMLDivElement;

		expect(proxy.ownerDocument).toBe(foreignDocument);
		expect(proxy.parentElement).toBe(foreignDocument.body);
		expect(document.body.contains(proxy)).toBe(false);
	});

	it("creates and resolves synthetic hover events in the element owner window", () => {
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		const foreignWindow = frame.contentWindow;
		expect(foreignDocument).toBeTruthy();
		expect(foreignWindow).toBeTruthy();
		if (!foreignDocument || !foreignWindow) {
			return;
		}

		const element = foreignDocument.createElement("div");
		element.dataset.cclInteractionId = "item:foreign";
		foreignDocument.body.append(element);

		const event = createHoverPreviewMouseEvent(element);

		expect(event).toBeInstanceOf((foreignWindow as any).MouseEvent);
		expect(event).not.toBeInstanceOf(MouseEvent);
		expect(resolveHoverPreviewTargetElement(event)).toBe(element);
	});
});
