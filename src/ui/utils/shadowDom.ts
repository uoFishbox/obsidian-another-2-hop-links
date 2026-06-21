export type QueryRoot = ParentNode | ShadowRoot | DocumentFragment;

import {
	isElementLike,
	isHTMLElementLike,
	isShadowRootLike,
} from "./realmSafeDom";

function isShadowHost(
	value: unknown,
): value is Element & { shadowRoot: ShadowRoot | null } {
	return isElementLike(value) && "shadowRoot" in value;
}

function getRootHost(node: Node | null): HTMLElement | null {
	const root = node?.getRootNode?.();
	return isShadowRootLike(root) && isHTMLElementLike(root.host)
		? root.host
		: null;
}

export function findClosestComposed(
	target: EventTarget | null,
	selector: string,
): HTMLElement | null {
	if (!isElementLike(target)) {
		return null;
	}

	let current: Element | null = target;
	while (current) {
		const match = current.closest(selector);
		if (isHTMLElementLike(match)) {
			return match;
		}

		current = getRootHost(current);
	}

	return null;
}

export function findMatchingElementInComposedPath(
	event: Event,
	selector: string,
): HTMLElement | null {
	for (const entry of event.composedPath()) {
		if (!isElementLike(entry)) {
			continue;
		}

		if (entry.matches(selector)) {
			return isHTMLElementLike(entry) ? entry : null;
		}

		const closest = entry.closest(selector);
		if (isHTMLElementLike(closest)) {
			return closest;
		}
	}

	return findClosestComposed(event.target, selector);
}

export function querySelectorAllIncludingShadow<
	T extends HTMLElement = HTMLElement,
>(root: QueryRoot | null | undefined, selector: string): T[] {
	if (!root) {
		return [];
	}

	const results: T[] = [];
	const visited = new Set<Node>();

	const walk = (currentRoot: QueryRoot): void => {
		if (visited.has(currentRoot as unknown as Node)) {
			return;
		}
		visited.add(currentRoot as unknown as Node);

		const matched = currentRoot.querySelectorAll<T>(selector);
		for (let i = 0; i < matched.length; i++) {
			results.push(matched[i]);
		}

		if (isShadowHost(currentRoot) && currentRoot.shadowRoot) {
			walk(currentRoot.shadowRoot);
		}

		const allElements = currentRoot.querySelectorAll("*");
		for (let i = 0; i < allElements.length; i++) {
			const el = allElements[i];
			if (!isShadowHost(el) || !el.shadowRoot) {
				continue;
			}

			walk(el.shadowRoot);
		}
	};

	walk(root);
	return results;
}
