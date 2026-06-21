import { PROXY_CLASS_NAME } from "./internal-constants";

type ProxyEntry = {
	proxy: HTMLElement;
	actual: HTMLElement;
	lastRect: {
		left: number;
		top: number;
		width: number;
		height: number;
	} | null;
};

export class ShadowAnchorRegistry {
	private readonly proxiesByActual = new Map<HTMLElement, ProxyEntry>();
	private readonly actualByProxy = new WeakMap<HTMLElement, HTMLElement>();
	private readonly hoveredActuals = new Set<HTMLElement>();

	private createProxy(actual: HTMLElement): HTMLElement {
		const doc = actual.ownerDocument;
		const proxy = doc.createElement("div");
		proxy.className = PROXY_CLASS_NAME;
		proxy.setAttribute("aria-hidden", "true");
		proxy.style.position = "fixed";
		proxy.style.left = "0px";
		proxy.style.top = "0px";
		proxy.style.width = "0px";
		proxy.style.height = "0px";
		proxy.style.pointerEvents = "none";
		proxy.style.visibility = "hidden";
		proxy.style.opacity = "0";
		proxy.style.margin = "0";
		proxy.style.padding = "0";
		proxy.style.border = "0";
		proxy.style.zIndex = "-1";
		(doc.body ?? doc.documentElement).appendChild(proxy);
		return proxy;
	}

	private resetProxyRect(entry: ProxyEntry): void {
		this.applyProxyRect(entry, 0, 0, 0, 0);
	}

	private applyProxyRect(
		entry: ProxyEntry,
		left: number,
		top: number,
		width: number,
		height: number,
	): void {
		const lastRect = entry.lastRect;
		if (
			lastRect &&
			lastRect.left === left &&
			lastRect.top === top &&
			lastRect.width === width &&
			lastRect.height === height
		) {
			return;
		}

		entry.proxy.style.left = `${left}px`;
		entry.proxy.style.top = `${top}px`;
		entry.proxy.style.width = `${width}px`;
		entry.proxy.style.height = `${height}px`;

		if (!entry.lastRect) {
			entry.lastRect = { left, top, width, height };
			return;
		}

		entry.lastRect.left = left;
		entry.lastRect.top = top;
		entry.lastRect.width = width;
		entry.lastRect.height = height;
	}

	getActual(proxy: HTMLElement): HTMLElement | null {
		return this.actualByProxy.get(proxy) ?? null;
	}

	resolveActual(element: HTMLElement): HTMLElement | null {
		return this.actualByProxy.get(element) ?? element;
	}

	syncProxyRect(element: HTMLElement): HTMLElement | null {
		const actual = this.resolveActual(element);
		return actual ? this.syncProxyRectForActual(actual) : null;
	}

	syncProxyRectForActual(actual: HTMLElement): HTMLElement {
		let entry = this.proxiesByActual.get(actual);
		if (!entry || entry.proxy.ownerDocument !== actual.ownerDocument) {
			entry?.proxy.remove();
			const proxy = this.createProxy(actual);
			entry = {
				proxy,
				actual,
				lastRect: null,
			};
			this.proxiesByActual.set(actual, entry);
			this.actualByProxy.set(proxy, actual);
		}

		if (!actual.isConnected) {
			this.resetProxyRect(entry);
			const proxy = entry.proxy;
			this.releaseActual(actual);
			return proxy;
		}

		const rect = actual.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			this.hoveredActuals.delete(actual);
			this.resetProxyRect(entry);
			return entry.proxy;
		}

		this.applyProxyRect(
			entry,
			rect.left,
			rect.top,
			rect.width,
			rect.height,
		);
		return entry.proxy;
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

	releaseActual(actual: HTMLElement): void {
		this.hoveredActuals.delete(actual);
		const entry = this.proxiesByActual.get(actual);
		if (entry) {
			entry.proxy.remove();
			this.proxiesByActual.delete(actual);
		}
	}

	destroy(): void {
		for (const entry of this.proxiesByActual.values()) {
			entry.proxy.remove();
		}
		this.proxiesByActual.clear();
		this.hoveredActuals.clear();
	}
}
