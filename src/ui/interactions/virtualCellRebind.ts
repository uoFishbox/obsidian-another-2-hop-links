export const VIRTUAL_CELL_WILL_REBIND_EVENT = "cclvirtualcellwillrebind";

export interface VirtualCellWillRebindDetail {
	readonly previousLogicalKey: string;
	readonly nextLogicalKey: string;
}

/** Announces that a physical cell is about to stop representing a logical card. */
export function dispatchVirtualCellWillRebind(
	element: HTMLElement,
	detail: VirtualCellWillRebindDetail,
): void {
	const activeElement = element.ownerDocument.activeElement;
	if (
		activeElement &&
		"blur" in activeElement &&
		typeof activeElement.blur === "function" &&
		element.contains(activeElement)
	) {
		activeElement.blur();
	}
	for (const interaction of element.querySelectorAll<HTMLElement>(
		"[data-ccl-interaction-id]",
	)) {
		delete interaction.dataset.cclHovered;
		delete interaction.dataset.cclLongPressed;
		delete interaction.dataset.cclLastTouchAt;
	}

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
