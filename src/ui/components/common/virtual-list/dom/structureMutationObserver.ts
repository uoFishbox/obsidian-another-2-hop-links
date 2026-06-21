import { findClosestComposed } from "ui/utils/shadowDom";
import { isHTMLElementLike } from "ui/utils/realmSafeDom";

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

export const hasRelevantStructureMutation = (
	mutation: MutationRecord,
): boolean => {
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
