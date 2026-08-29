import { isHTMLElementLike, isShadowRootLike } from "shared/ui/dom/realmSafeDom";

const PROXY_CLASS_NAME = "ccl-shadow-hover-proxy-anchor";

const PROXY_ATTRIBUTE_NAME = "data-ccl-shadow-hover-proxy";

type ProxyRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

type ProxyEntry = {
	proxy: HTMLElement;
	actual: HTMLElement;
	lastRect: ProxyRect | null;
};

function getDefaultProxyContainer(documentRef: Document): HTMLElement {
	return documentRef.body ?? documentRef.documentElement;
}

function resolveHoverPopoverContainer(actual: HTMLElement): HTMLElement | null {
	let root: Node = actual.getRootNode();

	while (isShadowRootLike(root) && isHTMLElementLike(root.host)) {
		const host = root.host;
		const hoverPopover = host.closest(".hover-popover");
		if (isHTMLElementLike(hoverPopover)) {
			return hoverPopover;
		}
		root = host.getRootNode();
	}

	return null;
}

function resolveProxyContainer(actual: HTMLElement): HTMLElement {
	return (
		resolveHoverPopoverContainer(actual) ??
		getDefaultProxyContainer(actual.ownerDocument)
	);
}

/**
 * Owns non-interactive light-DOM geometry proxies for Shadow DOM elements.
 */
export interface ShadowGeometryProxyStore {
	get(actual: HTMLElement): HTMLElement | null;
	getActual(proxy: HTMLElement): HTMLElement | null;
	release(actual: HTMLElement): boolean;
	resolveActual(element: HTMLElement): HTMLElement;
	sync(actual: HTMLElement): HTMLElement;
	destroy(documentRef?: Document): void;
}

/**
 * Creates an isolated proxy store so independent hover owners cannot release
 * each other's geometry targets.
 */
export function createShadowGeometryProxyStore(): ShadowGeometryProxyStore {
	const proxiesByActual = new Map<HTMLElement, ProxyEntry>();
	const actualByProxy = new WeakMap<HTMLElement, HTMLElement>();

	function createProxy(actual: HTMLElement): HTMLElement {
		const documentRef = actual.ownerDocument;
		const proxy = documentRef.createElement("div");
		proxy.className = PROXY_CLASS_NAME;
		proxy.setAttribute(PROXY_ATTRIBUTE_NAME, "1");
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
		resolveProxyContainer(actual).appendChild(proxy);
		return proxy;
	}

	function applyProxyRect(entry: ProxyEntry, rect: ProxyRect): void {
		const lastRect = entry.lastRect;
		if (
			lastRect &&
			lastRect.left === rect.left &&
			lastRect.top === rect.top &&
			lastRect.width === rect.width &&
			lastRect.height === rect.height
		) {
			return;
		}

		entry.proxy.style.left = `${rect.left}px`;
		entry.proxy.style.top = `${rect.top}px`;
		entry.proxy.style.width = `${rect.width}px`;
		entry.proxy.style.height = `${rect.height}px`;
		if (!lastRect) {
			entry.lastRect = { ...rect };
			return;
		}
		lastRect.left = rect.left;
		lastRect.top = rect.top;
		lastRect.width = rect.width;
		lastRect.height = rect.height;
	}

	function resetProxyRect(entry: ProxyEntry): void {
		applyProxyRect(entry, { left: 0, top: 0, width: 0, height: 0 });
	}

	function release(actual: HTMLElement): boolean {
		const entry = proxiesByActual.get(actual);
		if (!entry) {
			return false;
		}

		entry.proxy.remove();
		proxiesByActual.delete(actual);
		actualByProxy.delete(entry.proxy);
		return true;
	}

	function pruneDisconnectedEntries(): void {
		for (const entry of proxiesByActual.values()) {
			if (entry.actual.isConnected && entry.proxy.isConnected) {
				continue;
			}
			release(entry.actual);
		}
	}

	function sync(actual: HTMLElement): HTMLElement {
		pruneDisconnectedEntries();

		let entry = proxiesByActual.get(actual);
		if (!entry || entry.proxy.ownerDocument !== actual.ownerDocument) {
			release(actual);
			const proxy = createProxy(actual);
			entry = { proxy, actual, lastRect: null };
			proxiesByActual.set(actual, entry);
			actualByProxy.set(proxy, actual);
		}

		if (!actual.isConnected) {
			resetProxyRect(entry);
			const proxy = entry.proxy;
			release(actual);
			return proxy;
		}

		const proxyContainer = resolveProxyContainer(actual);
		if (entry.proxy.parentElement !== proxyContainer) {
			proxyContainer.appendChild(entry.proxy);
		}

		const rect = actual.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			resetProxyRect(entry);
			return entry.proxy;
		}

		applyProxyRect(entry, {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		});
		return entry.proxy;
	}

	function get(actual: HTMLElement): HTMLElement | null {
		if (!actual.isConnected) {
			release(actual);
			return null;
		}

		const entry = proxiesByActual.get(actual);
		if (!entry?.proxy.isConnected) {
			release(actual);
			return null;
		}
		if (
			entry.proxy.ownerDocument !== actual.ownerDocument ||
			entry.proxy.parentElement !== resolveProxyContainer(actual)
		) {
			return sync(actual);
		}
		return entry.proxy;
	}

	function getActual(proxy: HTMLElement): HTMLElement | null {
		return actualByProxy.get(proxy) ?? null;
	}

	function resolveActual(element: HTMLElement): HTMLElement {
		return actualByProxy.get(element) ?? element;
	}

	function destroy(documentRef?: Document): void {
		for (const entry of proxiesByActual.values()) {
			if (documentRef && entry.proxy.ownerDocument !== documentRef) {
				continue;
			}
			release(entry.actual);
		}
	}

	return {
		get,
		getActual,
		release,
		resolveActual,
		sync,
		destroy,
	};
}
