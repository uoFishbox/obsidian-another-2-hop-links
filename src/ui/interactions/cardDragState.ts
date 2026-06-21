import type { Plugin } from "obsidian";

export const CARD_DRAGGING_BODY_CLASS = "ccl-card-dragging";

let markFrameId: number | null = null;
let selectionShimInput: HTMLInputElement | null = null;
let draggingDocument: Document | null = null;

function isNativeDragSelectionShimActive(input: HTMLInputElement): boolean {
	return (
		input.ownerDocument.activeElement === input &&
		input.selectionStart === 0 &&
		input.selectionEnd !== null &&
		input.selectionEnd > 0
	);
}

export function markCardDraggingSoon(doc: Document = document): void {
	draggingDocument = doc;
	if (markFrameId !== null) {
		return;
	}

	const win = doc.defaultView ?? window;
	if (typeof win.requestAnimationFrame === "function") {
		markFrameId = win.requestAnimationFrame(() => {
			markFrameId = null;
			doc.body.classList.add(CARD_DRAGGING_BODY_CLASS);
		});
		return;
	}

	win.setTimeout(() => {
		doc.body.classList.add(CARD_DRAGGING_BODY_CLASS);
	}, 0);
}

export function clearCardDraggingClass(): void {
	const doc = draggingDocument ?? document;
	const win = doc.defaultView ?? window;
	if (markFrameId !== null && typeof win.cancelAnimationFrame === "function") {
		win.cancelAnimationFrame(markFrameId);
		markFrameId = null;
	}

	doc.body.classList.remove(CARD_DRAGGING_BODY_CLASS);
	removeNativeDragSelectionShim();
	draggingDocument = null;
}

export function installNativeDragSelectionShim(doc: Document = document): void {
	markCardDraggingSoon(doc);

	if (selectionShimInput?.ownerDocument !== doc) {
		removeNativeDragSelectionShim();
	}

	if (selectionShimInput) {
		return;
	}

	const input = doc.createElement("input");
	input.className = "ccl-native-drag-selection-shim";
	input.value = "ccl-drag-selection-shim";
	input.setAttribute("aria-hidden", "true");
	input.tabIndex = -1;
	Object.assign(input.style, {
		position: "fixed",
		left: "-10000px",
		top: "0",
		width: "1px",
		height: "1px",
		opacity: "0",
		pointerEvents: "none",
		zIndex: "-1",
	});

	doc.body.appendChild(input);
	selectionShimInput = input;
	input.focus({ preventScroll: true });
	input.setSelectionRange(0, 8);

	if (!isNativeDragSelectionShimActive(input)) {
		console.warn("[Cosense card links] Native drag selection shim was not active before drag", {
			activeElement: doc.activeElement,
			selectionStart: input.selectionStart,
			selectionEnd: input.selectionEnd,
			isConnected: input.isConnected,
		});
	}
}

function removeNativeDragSelectionShim(): void {
	const input = selectionShimInput;
	selectionShimInput = null;

	if (input) {
		try {
			input.setSelectionRange(0, 0);
			input.blur();
		} catch {
			// Ignore cleanup failures for detached inputs.
		}
		input.remove();
	}
}

export function registerCardDragStateCleanup(plugin: Plugin): void {
	plugin.registerDomEvent(document, "dragend", clearCardDraggingClass, true);
	plugin.registerDomEvent(document, "drop", clearCardDraggingClass, true);
	plugin.registerDomEvent(
		document,
		"dragcancel" as keyof DocumentEventMap,
		clearCardDraggingClass as EventListener,
		true,
	);
	plugin.registerDomEvent(
		document,
		"keydown",
		(event) => {
			if (event.key === "Escape") {
				clearCardDraggingClass();
			}
		},
		true,
	);
	plugin.register(clearCardDraggingClass);
}
