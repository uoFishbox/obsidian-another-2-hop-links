import { createShadowGeometryProxyStore } from "./geometry-proxy";
import { createOwnerMouseEvent } from "ui/shared/dom/realmSafeDom";

export class ShadowAnchorRegistry {
	private readonly proxyStore = createShadowGeometryProxyStore();
	private readonly hoveredActuals = new Set<HTMLElement>();

	getActual(proxy: HTMLElement): HTMLElement | null {
		return this.proxyStore.getActual(proxy);
	}

	resolveActual(element: HTMLElement): HTMLElement | null {
		return this.proxyStore.resolveActual(element);
	}

	syncProxyRect(element: HTMLElement): HTMLElement | null {
		const actual = this.resolveActual(element);
		return actual ? this.syncProxyRectForActual(actual) : null;
	}

	syncProxyRectForActual(actual: HTMLElement): HTMLElement {
		const proxy = this.proxyStore.sync(actual);
		if (
			!actual.isConnected ||
			proxy.style.width === "0px" ||
			proxy.style.height === "0px"
		) {
			this.hoveredActuals.delete(actual);
		}
		return proxy;
	}

	setHovered(actual: HTMLElement, hovered: boolean): void {
		if (hovered) {
			this.hoveredActuals.add(actual);
			return;
		}
		this.hoveredActuals.delete(actual);
	}

	isHovered(element: HTMLElement): boolean {
		const actual = this.resolveActual(element);
		return actual ? this.hoveredActuals.has(actual) : false;
	}

	isActualHovered(actual: HTMLElement): boolean {
		return this.hoveredActuals.has(actual);
	}

	relayHoverToProxy(actual: HTMLElement, hovered: boolean): boolean {
		const proxy = this.proxyStore.get(actual);
		if (!proxy) {
			return false;
		}

		const rect = actual.getBoundingClientRect();
		const event = createOwnerMouseEvent(proxy, hovered ? "mouseover" : "mouseout", {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			relatedTarget: null,
		});
		proxy.dispatchEvent(event);
		return true;
	}

	releaseActual(actual: HTMLElement): void {
		this.hoveredActuals.delete(actual);
		this.proxyStore.release(actual);
	}

	destroy(): void {
		this.proxyStore.destroy();
		this.hoveredActuals.clear();
	}
}
