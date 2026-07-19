import { isHTMLElementLike, isShadowRootLike } from "ui/shared/dom/realmSafeDom";

export const collectPositionDependencyElements = (
	rootEl: HTMLElement,
	scrollContainer: HTMLElement | null,
): HTMLElement[] => {
	const observedElements = new Set<HTMLElement>();

	const inlineHost = scrollContainer?.classList.contains("ccl-inline-card-host")
		? scrollContainer
		: rootEl.closest<HTMLElement>(".cm-scroller.ccl-inline-card-host");

	if (inlineHost) {
		for (const child of Array.from(inlineHost.children)) {
			if (isHTMLElementLike(child) && child.classList.contains("cm-sizer")) {
				observedElements.add(child);
				break;
			}
		}
	}

	return Array.from(observedElements);
};

export const collectStructureDependencyTargets = (
	rootEl: HTMLElement,
	scrollContainer: HTMLElement | null,
): Node[] => {
	const observedTargets = new Set<Node>();
	const directParent = rootEl.parentNode;
	if (isHTMLElementLike(directParent) || isShadowRootLike(directParent)) {
		observedTargets.add(directParent);
	}

	const rootNode = rootEl.getRootNode?.();
	if (isShadowRootLike(rootNode)) {
		observedTargets.add(rootNode);
	}

	if (scrollContainer) {
		observedTargets.add(scrollContainer);
	}

	return Array.from(observedTargets);
};
