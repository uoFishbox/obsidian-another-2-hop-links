import {
	getOptionalOwnerWindow,
	isHTMLElementLike,
	isShadowRootLike,
} from "shared/ui/dom/realmSafeDom";

const SCROLLABLE_OVERFLOW_PATTERN = /(auto|scroll|overlay)/;

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
