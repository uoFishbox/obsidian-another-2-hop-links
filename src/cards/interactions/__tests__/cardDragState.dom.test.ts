import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CARD_DRAGGING_BODY_CLASS,
	clearCardDraggingClass,
	installNativeDragSelectionShim,
} from "../cardDragState";

afterEach(() => {
	clearCardDraggingClass();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe("cardDragState multi-window cleanup", () => {
	it("cleans a drag started in a foreign document from that document's dragend", async () => {
		vi.useFakeTimers();
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const foreignDocument = frame.contentDocument;
		const foreignWindow = frame.contentWindow;
		expect(foreignDocument).toBeTruthy();
		expect(foreignWindow).toBeTruthy();
		if (!foreignDocument || !foreignWindow) return;

		installNativeDragSelectionShim(foreignDocument);
		await vi.runAllTimersAsync();
		expect(
			foreignDocument.querySelector(".ccl-native-drag-selection-shim"),
		).not.toBeNull();
		expect(foreignDocument.body).toHaveClass(CARD_DRAGGING_BODY_CLASS);

		const foreignEventWindow = foreignWindow as Window & {
			Event: typeof Event;
		};
		foreignDocument.dispatchEvent(new foreignEventWindow.Event("dragend"));

		expect(
			foreignDocument.querySelector(".ccl-native-drag-selection-shim"),
		).toBeNull();
		expect(foreignDocument.body).not.toHaveClass(CARD_DRAGGING_BODY_CLASS);
	});
});
