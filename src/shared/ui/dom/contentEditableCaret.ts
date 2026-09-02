/** Returns true when a collapsed DOM selection is at the textual end of the element. */
export function isCaretAtContentEnd(element: HTMLElement): boolean {
	const selection = element.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
		return false;
	}

	const caretRange = selection.getRangeAt(0);
	if (
		caretRange.endContainer !== element &&
		!element.contains(caretRange.endContainer)
	) {
		return false;
	}

	const trailingRange = element.ownerDocument.createRange();
	trailingRange.selectNodeContents(element);
	try {
		trailingRange.setStart(caretRange.endContainer, caretRange.endOffset);
	} catch {
		return false;
	}

	return trailingRange.toString().length === 0;
}

/** Returns true for an unmodified Enter press with the caret at the element end. */
export function isPlainEnterAtContentEnd(
	event: KeyboardEvent,
	element: HTMLElement,
): boolean {
	if (
		event.key !== "Enter" ||
		event.isComposing ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey
	) {
		return false;
	}

	return isCaretAtContentEnd(element);
}
