import type { MarkdownView } from "obsidian";
import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";

const INLINE_TITLE_SELECTOR = ".inline-title";
const EDITOR_CONTENT_SELECTOR = ".cm-editor .cm-content";
const FRONTMATTER_DELIMITER = "---";
const BOM = "\uFEFF";

type EditorNavigationKey = "Backspace" | "PageUp";

function isPlainEditorKey(
	view: MarkdownView,
	event: KeyboardEvent,
	key: EditorNavigationKey,
): boolean {
	if (
		view.getMode() !== "source" ||
		event.key !== key ||
		event.isComposing ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		!isHTMLElementLike(event.target)
	) {
		return false;
	}

	const editorContentEl = event.target.closest<HTMLElement>(EDITOR_CONTENT_SELECTOR);
	return !!editorContentEl && view.containerEl.contains(editorContentEl);
}

function resolveFirstEditableLine(view: MarkdownView): number {
	const editor = view.editor;
	const firstLine = editor.getLine(0);
	if (
		firstLine !== FRONTMATTER_DELIMITER &&
		firstLine !== `${BOM}${FRONTMATTER_DELIMITER}`
	) {
		return 0;
	}

	for (let line = 1; line < editor.lineCount(); line += 1) {
		if (editor.getLine(line) === FRONTMATTER_DELIMITER) {
			return line + 1;
		}
	}

	return 0;
}

function prependEditableLine(view: MarkdownView, line: number, text: string): void {
	const editor = view.editor;
	if (line < editor.lineCount()) {
		const isEmptyDocument =
			line === 0 && editor.lineCount() === 1 && editor.getLine(0).length === 0;
		if (isEmptyDocument) {
			if (text.length > 0) {
				editor.replaceRange(text, { line, ch: 0 });
			}
			return;
		}

		editor.replaceRange(`${text}\n`, { line, ch: 0 });
		return;
	}

	const lastLine = editor.lineCount() - 1;
	editor.replaceRange(`\n${text}`, {
		line: lastLine,
		ch: editor.getLine(lastLine).length,
	});
}

function getTitleTrailingRange(titleEl: HTMLElement): Range | null {
	const selection = titleEl.ownerDocument.getSelection();
	if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
		return null;
	}

	const caretRange = selection.getRangeAt(0);
	if (!titleEl.contains(caretRange.startContainer)) {
		return null;
	}

	const trailingRange = titleEl.ownerDocument.createRange();
	trailingRange.selectNodeContents(titleEl);
	trailingRange.setStart(caretRange.startContainer, caretRange.startOffset);
	return trailingRange;
}

function focusTitleAtMergeBoundary(
	titleEl: HTMLElement,
	trailingText: string,
): boolean {
	const ownerDocument = titleEl.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const selection = ownerDocument.getSelection();
	if (!ownerWindow || !selection) {
		return false;
	}

	titleEl.focus();
	const range = ownerDocument.createRange();
	if (trailingText.length === 0) {
		range.selectNodeContents(titleEl);
		range.collapse(false);
	} else {
		const trailingTextNode = ownerDocument.createTextNode(trailingText);
		titleEl.append(trailingTextNode);
		range.setStart(trailingTextNode, 0);
		range.collapse(true);
	}

	selection.removeAllRanges();
	selection.addRange(range);

	if (trailingText.length > 0) {
		titleEl.dispatchEvent(
			new ownerWindow.InputEvent("input", {
				bubbles: true,
				composed: true,
				data: trailingText,
				inputType: "insertText",
			}),
		);
	}

	return true;
}

function focusTitleAtStart(titleEl: HTMLElement): boolean {
	const ownerDocument = titleEl.ownerDocument;
	const selection = ownerDocument.getSelection();
	if (!selection) {
		return false;
	}

	titleEl.focus();
	const range = ownerDocument.createRange();
	range.selectNodeContents(titleEl);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}

function removeEditorLine(view: MarkdownView, line: number): void {
	const editor = view.editor;
	const lineText = editor.getLine(line);
	if (editor.lineCount() === 1) {
		if (lineText.length > 0) {
			editor.replaceRange("", { line, ch: 0 }, { line, ch: lineText.length });
		}
		return;
	}

	if (line < editor.lineCount() - 1) {
		editor.replaceRange("", { line, ch: 0 }, { line: line + 1, ch: 0 });
		return;
	}

	const previousLine = line - 1;
	editor.replaceRange(
		"",
		{ line: previousLine, ch: editor.getLine(previousLine).length },
		{ line, ch: lineText.length },
	);
}

/**
 * Handles Enter in an inline title by moving text after the caret to a new
 * first body line after frontmatter and focusing the start of that line.
 * Enter at the textual start of the title is left to Obsidian's default handling.
 */
export function handleMarkdownInlineTitleEnter(
	view: MarkdownView,
	event: KeyboardEvent,
): boolean {
	if (
		view.getMode() !== "source" ||
		event.key !== "Enter" ||
		event.isComposing ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey
	) {
		return false;
	}

	if (!isHTMLElementLike(event.target)) {
		return false;
	}

	const titleEl = event.target.closest<HTMLElement>(INLINE_TITLE_SELECTOR);
	if (!titleEl || !view.containerEl.contains(titleEl)) {
		return false;
	}

	const activeElement = titleEl.ownerDocument.activeElement;
	if (activeElement !== titleEl && !titleEl.contains(activeElement)) {
		return false;
	}

	const trailingRange = getTitleTrailingRange(titleEl);
	const ownerWindow = titleEl.ownerDocument.defaultView;
	if (!trailingRange || !ownerWindow) {
		return false;
	}

	const leadingRange = titleEl.ownerDocument.createRange();
	leadingRange.selectNodeContents(titleEl);
	leadingRange.setEnd(trailingRange.startContainer, trailingRange.startOffset);
	if (leadingRange.toString().length === 0) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();

	const editor = view.editor;
	const editableLine = resolveFirstEditableLine(view);
	const trailingText = trailingRange.toString();
	prependEditableLine(view, editableLine, trailingText);

	if (trailingText.length > 0) {
		trailingRange.deleteContents();
		titleEl.dispatchEvent(
			new ownerWindow.InputEvent("input", {
				bubbles: true,
				composed: true,
				inputType: "deleteContentForward",
			}),
		);
	}

	editor.setCursor({ line: editableLine, ch: 0 });
	editor.focus();
	return true;
}

/**
 * Handles Backspace at the first body position by merging that editor line
 * into the inline title and focusing the merge boundary.
 */
export function handleMarkdownEditorBackspace(
	view: MarkdownView,
	event: KeyboardEvent,
): boolean {
	if (!isPlainEditorKey(view, event, "Backspace")) {
		return false;
	}

	const editor = view.editor;
	if (editor.somethingSelected()) {
		return false;
	}

	const cursor = editor.getCursor("head");
	if (cursor.ch !== 0 || cursor.line !== resolveFirstEditableLine(view)) {
		return false;
	}

	const titleEl = view.containerEl.querySelector<HTMLElement>(INLINE_TITLE_SELECTOR);
	const lineText = editor.getLine(cursor.line);
	if (!titleEl || !focusTitleAtMergeBoundary(titleEl, lineText)) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	removeEditorLine(view, cursor.line);
	return true;
}

/** Handles PageUp in the editor by moving the caret to the title start. */
export function handleMarkdownEditorPageUp(
	view: MarkdownView,
	event: KeyboardEvent,
): boolean {
	if (!isPlainEditorKey(view, event, "PageUp")) {
		return false;
	}

	const titleEl = view.containerEl.querySelector<HTMLElement>(INLINE_TITLE_SELECTOR);
	if (!titleEl || !focusTitleAtStart(titleEl)) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	return true;
}
