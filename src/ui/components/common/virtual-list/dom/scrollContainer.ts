import {
	getOptionalOwnerWindow,
	isHTMLElementLike,
	isShadowRootLike,
} from "ui/utils/realmSafeDom";

const SCROLLABLE_OVERFLOW_PATTERN = /(auto|scroll|overlay)/;

interface CachedScrollContainerResolution {
	parent: HTMLElement | null;
	rootNode: Node | null;
	scroller: HTMLElement | null;
}

const nearestScrollContainerCache = new WeakMap<
	HTMLElement,
	CachedScrollContainerResolution
>();

function getComposedParentElement(node: Node | null): HTMLElement | null {
	if (!node) {
		return null;
	}

	const parent = node.parentNode;
	if (isHTMLElementLike(parent)) {
		return parent;
	}

	if (isShadowRootLike(parent) && isHTMLElementLike(parent.host)) {
		return parent.host;
	}

	return null;
}

export function isWithinComposedTree(
	ancestor: HTMLElement,
	node: Node | null,
): boolean {
	let current: Node | null = node;
	while (current) {
		if (current === ancestor) {
			return true;
		}
		current = getComposedParentElement(current);
	}

	return false;
}

export function findNearestScrollContainer(
	element: HTMLElement | null,
): HTMLElement | null {
	const ownerWindow = getOptionalOwnerWindow(element);
	if (!ownerWindow) {
		return null;
	}

	let current = getComposedParentElement(element);
	let firstStyledCandidate: HTMLElement | null = null;
	while (current) {
		const style = ownerWindow.getComputedStyle(current);
		if (
			SCROLLABLE_OVERFLOW_PATTERN.test(style.overflowY) ||
			SCROLLABLE_OVERFLOW_PATTERN.test(style.overflow)
		) {
			firstStyledCandidate ??= current;
			if (current.scrollHeight > current.clientHeight + 1) {
				return current;
			}
		}
		current = getComposedParentElement(current);
	}

	return firstStyledCandidate;
}

/**
 * Avoids repeated composed-tree walks and getComputedStyle() reads while a
 * virtual-list root stays under the same scroller. Invalidate this cache for
 * operations that can change ancestry or scroll-container styling. See
 * virtual-list/PERFORMANCE.md for the ownership and invalidation contract.
 */
export function findNearestScrollContainerCached(
	element: HTMLElement | null,
): HTMLElement | null {
	if (!element) {
		return null;
	}

	const parent = getComposedParentElement(element);
	const rootNode = element.getRootNode?.() ?? null;
	const cached = nearestScrollContainerCache.get(element);
	if (
		cached &&
		cached.parent === parent &&
		cached.rootNode === rootNode &&
		(!cached.scroller || isWithinComposedTree(cached.scroller, element))
	) {
		return cached.scroller;
	}

	const scroller = findNearestScrollContainer(element);
	nearestScrollContainerCache.set(element, {
		parent,
		rootNode,
		scroller,
	});
	return scroller;
}

export function invalidateNearestScrollContainerCache(
	element: HTMLElement | null,
): void {
	if (element) {
		nearestScrollContainerCache.delete(element);
	}
}
