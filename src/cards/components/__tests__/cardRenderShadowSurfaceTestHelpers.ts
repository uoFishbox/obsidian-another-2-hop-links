export interface ShadowSurfaceFixture {
	readonly host: HTMLElement;
	readonly root: ShadowRoot;
}

/**
 * Creates a host element with an open shadow root.
 *
 * jsdom parses constructed CSS but does not implement adoption yet, so
 * `adoptedStyleSheets` has to exist before the surface is created.
 */
export function createShadowSurfaceFixture(
	ownerDocument: Document = document,
): ShadowSurfaceFixture {
	const host = ownerDocument.createElement("div");
	ownerDocument.body.append(host);
	const root = host.attachShadow({ mode: "open" });
	Object.defineProperty(root, "adoptedStyleSheets", {
		value: [],
		writable: true,
		configurable: true,
	});
	return { host, root };
}

/** Returns the concatenated text of every style element inside a shadow root. */
export function collectShadowStyleText(root: ShadowRoot): string {
	return Array.from(root.querySelectorAll("style"))
		.map((style) => style.textContent ?? "")
		.join("\n");
}
