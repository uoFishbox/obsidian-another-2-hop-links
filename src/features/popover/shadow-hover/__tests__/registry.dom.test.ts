import { afterEach, describe, expect, it, vi } from "vitest";
import { ShadowAnchorRegistry } from "../registry";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ShadowAnchorRegistry", () => {
	it("relays actual hover state as proxy mouseover and mouseout", () => {
		const registry = new ShadowAnchorRegistry();
		const host = document.createElement("div");
		document.body.append(host);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const actual = document.createElement("button");
		actual.getBoundingClientRect = () =>
			({
				left: 10,
				top: 20,
				width: 40,
				height: 20,
				right: 50,
				bottom: 40,
				x: 10,
				y: 20,
				toJSON: () => ({}),
			}) as DOMRect;
		shadowRoot.append(actual);
		const proxy = registry.syncProxyRectForActual(actual);
		const events: MouseEvent[] = [];
		proxy.addEventListener("mouseover", (event) => events.push(event));
		proxy.addEventListener("mouseout", (event) => events.push(event));

		expect(registry.relayHoverToProxy(actual, true)).toBe(true);
		expect(registry.relayHoverToProxy(actual, false)).toBe(true);

		expect(events.map((event) => event.type)).toEqual(["mouseover", "mouseout"]);
		expect(events.every((event) => event.target === proxy)).toBe(true);
		expect(events.every((event) => event.bubbles)).toBe(true);
		expect(events.map((event) => [event.clientX, event.clientY])).toEqual([
			[30, 30],
			[30, 30],
		]);
	});

	it("does not create a proxy only to relay a missing target", () => {
		const registry = new ShadowAnchorRegistry();
		const actual = document.createElement("button");
		document.body.append(actual);
		const dispatchEvent = vi.spyOn(actual, "dispatchEvent");

		expect(registry.relayHoverToProxy(actual, true)).toBe(false);
		expect(dispatchEvent).not.toHaveBeenCalled();
		expect(document.querySelector(".ccl-shadow-hover-proxy-anchor")).toBeNull();
	});
});
