import { findClosestComposed } from "ui/shared/dom/shadowDom";
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

export interface SharedResizeObserverRegistry<TSubscriber> {
	observer: ResizeObserver;
	subscribersByTarget: Map<HTMLElement, Set<TSubscriber>>;
}

export function observeSharedResizeTarget<TSubscriber>(
	registry: SharedResizeObserverRegistry<TSubscriber>,
	target: HTMLElement,
	subscriber: TSubscriber,
): void {
	let subscribers = registry.subscribersByTarget.get(target);
	if (!subscribers) {
		subscribers = new Set<TSubscriber>();
		registry.subscribersByTarget.set(target, subscribers);
		registry.observer.observe(target);
	}

	subscribers.add(subscriber);
}

export function unobserveSharedResizeTarget<TSubscriber>(
	registry: SharedResizeObserverRegistry<TSubscriber> | null,
	target: HTMLElement,
	subscriber: TSubscriber,
	onEmpty?: () => void,
): void {
	if (!registry) {
		return;
	}

	const subscribers = registry.subscribersByTarget.get(target);
	if (!subscribers) {
		return;
	}

	subscribers.delete(subscriber);
	if (subscribers.size > 0) {
		return;
	}

	registry.subscribersByTarget.delete(target);
	registry.observer.unobserve(target);
	if (registry.subscribersByTarget.size === 0) {
		registry.observer.disconnect();
		onEmpty?.();
	}
}

export const STRUCTURE_MUTATION_IGNORE_SELECTOR = [
	"[data-ccl-shadow-hover-proxy]",
	"[data-ccl-hover-popover-anchor-proxy]",
	"[data-ccl-hover-popover-anchor-layer]",
	"[data-ccl-hover-popover-anchor]",
	"[data-ccl-preview-island]",
	"[data-ccl-vlist-ignore-structure]",
	".cosense-card-links__box-preview",
	".cosense-card-links__box-title-wrapper",
	".cosense-card-links__box-bookmark-bg",
	".ccl-native-drag-selection-shim",
	".ccl-shadow-hover-proxy-anchor",
	".skeleton-loader",
	".popover",
	".hover-popover",
	".menu",
	".suggestion-container",
	".notice-container",
].join(", ");

export const shouldIgnoreStructureMutationNode = (node: Node): boolean => {
	const element = isHTMLElementLike(node) ? node : node.parentElement;

	if (!element) {
		return false;
	}

	return (
		element.matches(STRUCTURE_MUTATION_IGNORE_SELECTOR) ||
		!!findClosestComposed(element, STRUCTURE_MUTATION_IGNORE_SELECTOR)
	);
};

export const hasRelevantStructureMutation = (mutation: MutationRecord): boolean => {
	if (shouldIgnoreStructureMutationNode(mutation.target)) {
		return false;
	}

	for (const node of mutation.addedNodes) {
		if (!shouldIgnoreStructureMutationNode(node)) {
			return true;
		}
	}

	for (const node of mutation.removedNodes) {
		if (!shouldIgnoreStructureMutationNode(node)) {
			return true;
		}
	}

	return false;
};
