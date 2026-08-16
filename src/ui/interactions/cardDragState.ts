import type { Plugin } from "obsidian";

export const CARD_DRAGGING_BODY_CLASS = "ccl-card-dragging";

let markFrameId: number | null = null;
let markFrameWindow: Window | null = null;
let selectionShimInput: HTMLInputElement | null = null;
let draggingDocument: Document | null = null;
let dragCleanupDocument: Document | null = null;
let removeDragCleanupListeners: (() => void) | null = null;

function isNativeDragSelectionShimActive(input: HTMLInputElement): boolean {
	return (
		input.ownerDocument.activeElement === input &&
		input.selectionStart === 0 &&
		input.selectionEnd !== null &&
		input.selectionEnd > 0
	);
}

function removeInstalledDragCleanupListeners(): void {
	removeDragCleanupListeners?.();
	removeDragCleanupListeners = null;
	dragCleanupDocument = null;
}

function ensureDragCleanupListeners(doc: Document): void {
	if (dragCleanupDocument === doc && removeDragCleanupListeners) {
		return;
	}
	removeInstalledDragCleanupListeners();

	const clear = () => clearCardDraggingClass();
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			clearCardDraggingClass();
		}
	};
	const dragCancelType = "dragcancel" as keyof DocumentEventMap;

	doc.addEventListener("dragend", clear, true);
	doc.addEventListener("drop", clear, true);
	doc.addEventListener(dragCancelType, clear as EventListener, true);
	doc.addEventListener("keydown", onKeyDown, true);

	dragCleanupDocument = doc;
	removeDragCleanupListeners = () => {
		doc.removeEventListener("dragend", clear, true);
		doc.removeEventListener("drop", clear, true);
		doc.removeEventListener(dragCancelType, clear as EventListener, true);
		doc.removeEventListener("keydown", onKeyDown, true);
	};
}

export function markCardDraggingSoon(doc: Document = document): void {
	if (draggingDocument && draggingDocument !== doc) {
		if (markFrameId !== null && markFrameWindow) {
			if (typeof markFrameWindow.cancelAnimationFrame === "function") {
				markFrameWindow.cancelAnimationFrame(markFrameId);
			} else {
				markFrameWindow.clearTimeout(markFrameId);
			}
		}
		markFrameId = null;
		markFrameWindow = null;
		draggingDocument.body.classList.remove(CARD_DRAGGING_BODY_CLASS);
	}
	draggingDocument = doc;
	if (markFrameId !== null) {
		return;
	}

	const win = doc.defaultView ?? (typeof window === "undefined" ? null : window);
	if (!win) {
		doc.body.classList.add(CARD_DRAGGING_BODY_CLASS);
		return;
	}
	markFrameWindow = win;
	if (typeof win.requestAnimationFrame === "function") {
		markFrameId = win.requestAnimationFrame(() => {
			markFrameId = null;
			markFrameWindow = null;
			doc.body.classList.add(CARD_DRAGGING_BODY_CLASS);
		});
		return;
	}

	markFrameId = win.setTimeout(() => {
		markFrameId = null;
		markFrameWindow = null;
		doc.body.classList.add(CARD_DRAGGING_BODY_CLASS);
	}, 0);
}

export function clearCardDraggingClass(): void {
	const doc = draggingDocument ?? dragCleanupDocument ?? null;
	if (markFrameId !== null && markFrameWindow) {
		if (typeof markFrameWindow.cancelAnimationFrame === "function") {
			markFrameWindow.cancelAnimationFrame(markFrameId);
		} else {
			markFrameWindow.clearTimeout(markFrameId);
		}
		markFrameId = null;
		markFrameWindow = null;
	}

	doc?.body.classList.remove(CARD_DRAGGING_BODY_CLASS);
	removeNativeDragSelectionShim();
	removeInstalledDragCleanupListeners();
	draggingDocument = null;
}

export function installNativeDragSelectionShim(doc: Document = document): void {
	ensureDragCleanupListeners(doc);
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
		console.warn(
			"[Cosense card links] Native drag selection shim was not active before drag",
			{
				activeElement: doc.activeElement,
				selectionStart: input.selectionStart,
				selectionEnd: input.selectionEnd,
				isConnected: input.isConnected,
			},
		);
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
	// Per-drag listeners are attached to the actual ownerDocument in
	// installNativeDragSelectionShim(), so popout dragend/drop/Escape events are
	// observed in the same realm that started the drag.
	plugin.register(clearCardDraggingClass);
}
