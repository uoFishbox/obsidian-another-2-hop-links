import { isElementLike, isNodeLike } from "ui/shared/dom/realmSafeDom";

export function rectToObject(rect: DOMRect): Record<string, number> {
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
		top: rect.top,
		right: rect.right,
		bottom: rect.bottom,
		left: rect.left,
	};
}

export function summarizeNode(node: unknown): Record<string, unknown> | null {
	if (!isNodeLike(node)) {
		return node == null ? null : { type: typeof node, value: String(node) };
	}

	const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
	if (isElementLike(node)) {
		return {
			nodeType: node.nodeType,
			tag: node.tagName,
			className: node.className,
			id: node.id || null,
			rootType: root?.constructor?.name ?? null,
		};
	}

	return {
		nodeType: node.nodeType,
		nodeName: node.nodeName,
		rootType: root?.constructor?.name ?? null,
	};
}
