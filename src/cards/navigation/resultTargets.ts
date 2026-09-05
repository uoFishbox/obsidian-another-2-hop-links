import {
	findClosestComposed,
	querySelectorAllIncludingShadow,
} from "shared/ui/dom/shadowDom";
import { isElementVisible } from "shared/ui/dom/domUtils";
import { isEventLike } from "shared/ui/dom/realmSafeDom";

export const CARD_SELECTOR = ".cosense-card-links__box[data-ccl-interaction-handle]";
export const LOAD_MORE_SELECTOR =
	"button.cosense-card-links__load-more-button.cosense-card-links__box";
export const RESULT_FOCUS_SELECTOR = `${CARD_SELECTOR}, ${LOAD_MORE_SELECTOR}`;
export const SEARCH_INPUT_SELECTOR = ".twohop-search-input";

export function collectResultTargets(container: HTMLElement | null): HTMLElement[] {
	return querySelectorAllIncludingShadow<HTMLElement>(
		container,
		RESULT_FOCUS_SELECTOR,
	).filter(
		(element) => !element.hasAttribute("disabled") && isElementVisible(element),
	);
}

export function getFocusableResultTarget(
	target: EventTarget | Event | null,
): HTMLElement | null {
	if (isEventLike(target)) {
		return findClosestComposed(
			target.composedPath()[0] ?? target.target,
			RESULT_FOCUS_SELECTOR,
		);
	}
	return findClosestComposed(target, RESULT_FOCUS_SELECTOR);
}

export function getResultTargetIdentity(element: HTMLElement): string | null {
	return element.dataset.cclInteractionHandle ?? null;
}
