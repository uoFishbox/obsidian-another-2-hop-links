import { afterEach, describe, expect, it } from "vitest";
import { createShadowGeometryProxyStore } from "../geometry-proxy";

afterEach(() => {
	document.body.innerHTML = "";
});

function createShadowTarget(): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	const shadowRoot = host.attachShadow({ mode: "open" });
	const target = document.createElement("div");
	target.getBoundingClientRect = () =>
		({
			left: 12.5,
			top: 34.5,
			width: 56.5,
			height: 78.5,
			right: 69,
			bottom: 113,
			x: 12.5,
			y: 34.5,
			toJSON: () => ({}),
		}) as DOMRect;
	shadowRoot.append(target);
	return target;
}

describe("createShadowGeometryProxyStore", () => {
	it("creates an exact non-interactive geometry target", () => {
		const store = createShadowGeometryProxyStore();
		const target = createShadowTarget();

		const proxy = store.sync(target);

		expect(proxy.parentElement).toBe(document.body);
		expect(proxy.classList.contains("ccl-shadow-hover-proxy-anchor")).toBe(true);
		expect(proxy.getAttribute("data-ccl-shadow-hover-proxy")).toBe("1");
		expect(proxy.style.pointerEvents).toBe("none");
		expect(proxy.style.visibility).toBe("hidden");
		expect(proxy.style.zIndex).toBe("-1");
		expect(proxy.style.left).toBe("12.5px");
		expect(proxy.style.top).toBe("34.5px");
		expect(proxy.style.width).toBe("56.5px");
		expect(proxy.style.height).toBe("78.5px");
	});

	it("keeps ownership isolated between stores", () => {
		const firstStore = createShadowGeometryProxyStore();
		const secondStore = createShadowGeometryProxyStore();
		const target = createShadowTarget();

		const firstProxy = firstStore.sync(target);
		const secondProxy = secondStore.sync(target);

		expect(firstProxy).not.toBe(secondProxy);
		firstStore.destroy();

		expect(firstProxy.isConnected).toBe(false);
		expect(firstStore.getActual(firstProxy)).toBeNull();
		expect(secondProxy.isConnected).toBe(true);
		expect(secondStore.get(target)).toBe(secondProxy);
	});
});
