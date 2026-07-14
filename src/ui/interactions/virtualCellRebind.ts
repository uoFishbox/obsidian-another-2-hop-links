export const VIRTUAL_CELL_WILL_REBIND_EVENT = "cclvirtualcellwillrebind";

export interface VirtualCellWillRebindDetail {
	readonly previousLogicalKey: string;
	readonly nextLogicalKey: string;
}

const dirtyVirtualCells = new WeakSet<HTMLElement>();

/** Marks a physical cell as holding transient interaction state. */
export function markVirtualCellInteractionDirty(cell: HTMLElement): void {
	dirtyVirtualCells.add(cell);
}

/**
 * Clears transient state before a dirty physical cell represents another card.
 * Clean cells return without reading or traversing the DOM.
 */
export function prepareVirtualCellForRebind(
	element: HTMLElement,
	previousLogicalKey: string,
	nextLogicalKey: string,
): boolean {
	if (!dirtyVirtualCells.delete(element)) {
		return false;
	}

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
			detail: {
				previousLogicalKey,
				nextLogicalKey,
			} satisfies VirtualCellWillRebindDetail,
		}),
	);
	return true;
}
