export const VIRTUAL_CELL_WILL_REBIND_EVENT = "cclvirtualcellwillrebind";

export interface VirtualCellWillRebindDetail {
	readonly previousLogicalKey: string;
	readonly nextLogicalKey: string;
}

const TRANSIENT_INTERACTION_SELECTOR = [
	'[data-ccl-hovered="true"]',
	'[data-ccl-long-pressed="1"]',
	"[data-ccl-last-touch-at]",
].join(",");

function dispatchRebindEvent(
	element: HTMLElement,
	detail: VirtualCellWillRebindDetail,
): void {
	const CustomEventConstructor =
		element.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
	element.dispatchEvent(
		new CustomEventConstructor(VIRTUAL_CELL_WILL_REBIND_EVENT, {
			bubbles: true,
			composed: true,
			detail,
		}),
	);
}

/** Announces that a physical cell is about to stop representing a logical card. */
export function dispatchVirtualCellWillRebind(
	element: HTMLElement,
	detail: VirtualCellWillRebindDetail,
): void {
	const activeElement = element.ownerDocument.activeElement;
	const hasFocusedDescendant = Boolean(
		activeElement &&
		"blur" in activeElement &&
		typeof activeElement.blur === "function" &&
		element.contains(activeElement),
	);
	const transientInteractions = element.querySelectorAll<HTMLElement>(
		TRANSIENT_INTERACTION_SELECTOR,
	);

	if (!hasFocusedDescendant && transientInteractions.length === 0) {
		return;
	}

	if (
		hasFocusedDescendant &&
		activeElement &&
		"blur" in activeElement &&
		typeof activeElement.blur === "function"
	) {
		activeElement.blur();
	}
	for (const interaction of transientInteractions) {
		delete interaction.dataset.cclHovered;
		delete interaction.dataset.cclLongPressed;
		delete interaction.dataset.cclLastTouchAt;
	}

	if (transientInteractions.length > 0) {
		dispatchRebindEvent(element, detail);
	}
}

/** Announces a rebind when the interaction state is stored on a known root. */
export function dispatchVirtualCellWillRebindFromRoot(
	element: HTMLElement,
	interactionRoot: HTMLElement,
	detail: VirtualCellWillRebindDetail,
): void {
	const activeElement = element.ownerDocument.activeElement;
	const hasFocusedDescendant = Boolean(
		activeElement &&
		"blur" in activeElement &&
		typeof activeElement.blur === "function" &&
		element.contains(activeElement),
	);
	const hasTransientInteraction =
		interactionRoot.dataset.cclHovered === "true" ||
		interactionRoot.dataset.cclLongPressed === "1" ||
		interactionRoot.dataset.cclLastTouchAt !== undefined;

	if (!hasFocusedDescendant && !hasTransientInteraction) return;

	if (
		hasFocusedDescendant &&
		activeElement &&
		"blur" in activeElement &&
		typeof activeElement.blur === "function"
	) {
		activeElement.blur();
	}
	if (!hasTransientInteraction) return;

	delete interactionRoot.dataset.cclHovered;
	delete interactionRoot.dataset.cclLongPressed;
	delete interactionRoot.dataset.cclLastTouchAt;
	dispatchRebindEvent(element, detail);
}
