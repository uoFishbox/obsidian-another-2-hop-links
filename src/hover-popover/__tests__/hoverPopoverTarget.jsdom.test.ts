import { afterEach, describe, expect, it } from "vitest";
import {
	createHoverPreviewMouseEvent,
	disposeShadowHoverPopoverProxies,
	getShadowHoverPopoverProxyElement,
	normalizeHoverPopoverTargetEl,
	resolveHoverPreviewTargetElement,
} from "../hoverPopoverTarget";

afterEach(() => {
	disposeShadowHoverPopoverProxies();
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
		expect(proxy.getAttribute("data-ccl-shadow-hover-proxy")).toBe("1");
		expect(proxy.classList.contains("ccl-shadow-hover-proxy-anchor")).toBe(true);
		expect(proxy.style.pointerEvents).toBe("none");
		expect(proxy.style.visibility).toBe("hidden");
		expect(proxy.style.zIndex).toBe("-1");
		expect(proxy.style.left).toBe("12px");
		expect(proxy.style.top).toBe("34px");
		expect(proxy.style.width).toBe("56px");
		expect(proxy.style.height).toBe("78px");
		expect(getShadowHoverPopoverProxyElement(target)).toBe(proxy);
	});

	it("does not relay pointer activation from the geometry proxy", () => {
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

		proxy.dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);

		expect(middleDown.defaultPrevented).toBe(false);
		expect(relayedEvents).toEqual([]);
	});

	it("reuses the proxy and refreshes its geometry", () => {
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const target = document.createElement("div");
		let left = 20;
		target.getBoundingClientRect = () =>
			({
				left,
				top: 40,
				width: 60,
				height: 80,
				right: left + 60,
				bottom: 120,
				x: left,
				y: 40,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(target);

		const proxy = normalizeHoverPopoverTargetEl(target) as HTMLDivElement;
		expect(proxy.style.left).toBe("20px");

		left = 120;
		const refreshed = normalizeHoverPopoverTargetEl(target);
		expect(refreshed).toBe(proxy);
		expect(proxy.style.left).toBe("120px");
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
