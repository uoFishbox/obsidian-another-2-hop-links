// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "obsidian";
import {
	handleMarkdownEditorBackspace,
	handleMarkdownEditorPageUp,
	handleMarkdownInlineTitleEnter,
} from "../markdownTitleEditorNavigationBridge";
import { isCaretAtContentEnd } from "shared/ui/dom/contentEditableCaret";

type EditorMock = {
	lineCount: ReturnType<typeof vi.fn>;
	getLine: ReturnType<typeof vi.fn>;
	getCursor: ReturnType<typeof vi.fn>;
	somethingSelected: ReturnType<typeof vi.fn>;
	replaceRange: ReturnType<typeof vi.fn>;
	setCursor: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
};

interface HarnessOptions {
	cursor?: { line: number; ch: number };
	hasSelection?: boolean;
}

function createHarness(lines: string[], options: HarnessOptions = {}) {
	const containerEl = document.createElement("div");
	const titleEl = document.createElement("div");
	titleEl.className = "inline-title";
	titleEl.contentEditable = "true";
	titleEl.tabIndex = 0;
	titleEl.textContent = "Example";
	containerEl.append(titleEl);
	const editorEl = document.createElement("div");
	editorEl.className = "cm-editor";
	const editorContentEl = document.createElement("div");
	editorContentEl.className = "cm-content";
	editorContentEl.contentEditable = "true";
	editorContentEl.tabIndex = 0;
	editorEl.append(editorContentEl);
	containerEl.append(editorEl);
	document.body.append(containerEl);

	const editor: EditorMock = {
		lineCount: vi.fn(() => lines.length),
		getLine: vi.fn((line: number) => lines[line] ?? ""),
		getCursor: vi.fn(() => options.cursor ?? { line: 0, ch: 0 }),
		somethingSelected: vi.fn(() => options.hasSelection ?? false),
		replaceRange: vi.fn(
			(text: string, from: EditorPosition, to: EditorPosition = from) => {
				const replacement =
					lines[from.line].slice(0, from.ch) +
					text +
					lines[to.line].slice(to.ch);
				lines.splice(
					from.line,
					to.line - from.line + 1,
					...replacement.split("\n"),
				);
			},
		),
		setCursor: vi.fn(),
		focus: vi.fn(),
	};
	const view = { containerEl, editor, getMode: () => "source" };

	let handled = false;
	containerEl.addEventListener(
		"keydown",
		(event) => {
			handled =
				handleMarkdownInlineTitleEnter(view as never, event) ||
				handleMarkdownEditorBackspace(view as never, event) ||
				handleMarkdownEditorPageUp(view as never, event);
		},
		true,
	);

	return {
		titleEl,
		editorContentEl,
		editor,
		getHandled: () => handled,
		getContent: () => lines.join("\n"),
	};
}

function setCaret(titleEl: HTMLElement, offset: number): void {
	const textNode = titleEl.firstChild;
	if (!textNode) throw new Error("title text node missing");

	const selection = document.getSelection();
	if (!selection) throw new Error("selection unavailable");

	// jsdom resets the selection when a contenteditable element receives focus.
	titleEl.focus();
	const range = document.createRange();
	range.setStart(textNode, offset);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

describe("handleMarkdownInlineTitleEnter", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		document.getSelection()?.removeAllRanges();
	});

	it("prepends a blank first line and focuses it when Enter is pressed at the title end", () => {
		const { titleEl, editor, getHandled } = createHarness(["existing text"]);
		setCaret(titleEl, titleEl.textContent?.length ?? 0);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(getHandled()).toBe(true);
		expect(editor.replaceRange).toHaveBeenCalledWith("\n", { line: 0, ch: 0 });
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});

	it("focuses the existing empty first line without adding another blank line", () => {
		const { titleEl, editor, getHandled } = createHarness([""]);
		setCaret(titleEl, titleEl.textContent?.length ?? 0);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(getHandled()).toBe(true);
		expect(editor.replaceRange).not.toHaveBeenCalled();
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
		expect(editor.focus).toHaveBeenCalledTimes(1);
	});

	it("inserts and focuses a blank line immediately below frontmatter", () => {
		const { titleEl, editor, getHandled } = createHarness([
			"---",
			"title: Example",
			"---",
			"existing text",
		]);
		setCaret(titleEl, titleEl.textContent?.length ?? 0);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(getHandled()).toBe(true);
		expect(editor.replaceRange).toHaveBeenCalledWith("\n", { line: 3, ch: 0 });
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
	});

	it("inserts a new line when the first body line below frontmatter is blank", () => {
		const { titleEl, editor } = createHarness([
			"---",
			"title: Example",
			"---",
			"",
			"existing text",
		]);
		setCaret(titleEl, titleEl.textContent?.length ?? 0);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(editor.replaceRange).toHaveBeenCalledWith("\n", { line: 3, ch: 0 });
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
	});

	it("appends an editable line when frontmatter ends at the end of the note", () => {
		const { titleEl, editor } = createHarness(["---", "title: Example", "---"]);
		setCaret(titleEl, titleEl.textContent?.length ?? 0);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(editor.replaceRange).toHaveBeenCalledWith("\n", { line: 2, ch: 3 });
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 });
	});

	it("treats an unclosed frontmatter delimiter as regular note content", () => {
		const { titleEl, editor } = createHarness([
			"---",
			"title: Example",
			"existing text",
		]);
		setCaret(titleEl, titleEl.textContent?.length ?? 0);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(editor.replaceRange).toHaveBeenCalledWith("\n", { line: 0, ch: 0 });
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
	});

	it.each([
		{ content: "existing text", expected: "mple\nexisting text", line: 0 },
		{ content: "", expected: "mple", line: 0 },
		{ content: "\nexisting text", expected: "mple\n\nexisting text", line: 0 },
		{
			content: "---\ntitle: Example\n---\nexisting text",
			expected: "---\ntitle: Example\n---\nmple\nexisting text",
			line: 3,
		},
		{
			content: "---\ntitle: Example\n---\n\nexisting text",
			expected: "---\ntitle: Example\n---\nmple\n\nexisting text",
			line: 3,
		},
		{
			content: "---\ntitle: Example\n---",
			expected: "---\ntitle: Example\n---\nmple",
			line: 3,
		},
		{
			content: "\uFEFF---\ntitle: Example\n---\nexisting text",
			expected: "\uFEFF---\ntitle: Example\n---\nmple\nexisting text",
			line: 3,
		},
		{
			content: "---\ntitle: Example",
			expected: "mple\n---\ntitle: Example",
			line: 0,
		},
	])(
		"moves the title suffix to the first body line for $content",
		({ content, expected, line }) => {
			const { titleEl, editor, getHandled, getContent } = createHarness(
				content.split("\n"),
			);
			const inputListener = vi.fn();
			titleEl.addEventListener("input", inputListener);
			setCaret(titleEl, 3);
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			});

			titleEl.dispatchEvent(event);

			expect(getHandled()).toBe(true);
			expect(event.defaultPrevented).toBe(true);
			expect(titleEl.textContent).toBe("Exa");
			expect(getContent()).toBe(expected);
			expect(editor.setCursor).toHaveBeenCalledWith({ line, ch: 0 });
			expect(editor.focus).toHaveBeenCalledTimes(1);
			expect(inputListener).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					inputType: "deleteContentForward",
					bubbles: true,
				}),
			);
		},
	);

	it("splits a title across nested text nodes", () => {
		const { titleEl, getContent } = createHarness(["body"]);
		titleEl.innerHTML = "<span>titletext1</span><span>titletext2</span>";
		setCaret(titleEl, 1);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(titleEl.textContent).toBe("titletext1");
		expect(getContent()).toBe("titletext2\nbody");
	});

	it.each(["Example", "<span>Example</span>", "<span></span>Example", ""])(
		"leaves Enter at the start of title markup %j to Obsidian",
		(markup) => {
			const { titleEl, editor, getHandled, getContent } = createHarness([
				"---",
				"title: Example",
				"---",
				"body",
			]);
			titleEl.innerHTML = markup;
			const originalTitle = titleEl.textContent;
			const titleKeydownListener = vi.fn();
			titleEl.addEventListener("keydown", titleKeydownListener);
			const inputListener = vi.fn();
			titleEl.addEventListener("input", inputListener);
			titleEl.focus();
			const selection = document.getSelection();
			const range = document.createRange();
			range.setStart(titleEl.firstChild ?? titleEl, 0);
			range.collapse(true);
			selection?.removeAllRanges();
			selection?.addRange(range);
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			});

			titleEl.dispatchEvent(event);

			expect(getHandled()).toBe(false);
			expect(event.defaultPrevented).toBe(false);
			expect(titleKeydownListener).toHaveBeenCalledExactlyOnceWith(event);
			expect(titleEl.textContent).toBe(originalTitle);
			expect(getContent()).toBe("---\ntitle: Example\n---\nbody");
			expect(document.activeElement).toBe(titleEl);
			expect(selection?.anchorNode).toBe(titleEl.firstChild ?? titleEl);
			expect(selection?.anchorOffset).toBe(0);
			expect(editor.replaceRange).not.toHaveBeenCalled();
			expect(editor.setCursor).not.toHaveBeenCalled();
			expect(editor.focus).not.toHaveBeenCalled();
			expect(inputListener).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ isComposing: true },
		{ shiftKey: true },
		{ ctrlKey: true },
		{ altKey: true },
		{ metaKey: true },
	])("does not split the title for modified or composing Enter: %j", (modifiers) => {
		const { titleEl, editor, getHandled } = createHarness(["existing text"]);
		setCaret(titleEl, 3);

		titleEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...modifiers }),
		);

		expect(getHandled()).toBe(false);
		expect(titleEl.textContent).toBe("Example");
		expect(editor.replaceRange).not.toHaveBeenCalled();
		expect(editor.setCursor).not.toHaveBeenCalled();
		expect(editor.focus).not.toHaveBeenCalled();
	});

	it.each(["selected text", "outside title", "missing selection"])(
		"does not split the title with %s",
		(selectionState) => {
			const { titleEl, editorContentEl, editor, getHandled } = createHarness([
				"body",
			]);
			setCaret(titleEl, 3);
			const selection = document.getSelection();
			const range = selection?.getRangeAt(0);
			if (selectionState === "selected text") {
				range?.selectNodeContents(titleEl);
			} else if (selectionState === "outside title") {
				range?.selectNodeContents(editorContentEl);
				range?.collapse(true);
			} else {
				selection?.removeAllRanges();
			}

			titleEl.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);

			expect(getHandled()).toBe(false);
			expect(titleEl.textContent).toBe("Example");
			expect(editor.replaceRange).not.toHaveBeenCalled();
		},
	);
});

describe("handleMarkdownEditorBackspace", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		document.getSelection()?.removeAllRanges();
	});

	it("removes an empty first line and moves the caret to the title end", () => {
		const { titleEl, editorContentEl, editor, getHandled } = createHarness([
			"",
			"next line",
		]);
		editorContentEl.focus();
		const event = new KeyboardEvent("keydown", {
			key: "Backspace",
			bubbles: true,
			cancelable: true,
		});

		editorContentEl.dispatchEvent(event);

		expect(getHandled()).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(titleEl);
		expect(isCaretAtContentEnd(titleEl)).toBe(true);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"",
			{ line: 0, ch: 0 },
			{ line: 1, ch: 0 },
		);
	});

	it("removes an empty first body line without deleting frontmatter", () => {
		const { titleEl, editorContentEl, editor, getHandled } = createHarness(
			["---", "title: Example", "---", "", "next line"],
			{ cursor: { line: 3, ch: 0 } },
		);
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);

		expect(getHandled()).toBe(true);
		expect(document.activeElement).toBe(titleEl);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"",
			{ line: 3, ch: 0 },
			{ line: 4, ch: 0 },
		);
	});

	it("removes the trailing newline when an empty body line follows frontmatter", () => {
		const { titleEl, editorContentEl, editor } = createHarness(
			["---", "title: Example", "---", ""],
			{ cursor: { line: 3, ch: 0 } },
		);
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);

		expect(document.activeElement).toBe(titleEl);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"",
			{ line: 2, ch: 3 },
			{ line: 3, ch: 0 },
		);
	});

	it("moves first-line text after the caret at the title end", () => {
		const { titleEl, editorContentEl, editor, getHandled } = createHarness([
			"moved text",
			"next line",
		]);
		const inputListener = vi.fn();
		titleEl.addEventListener("input", inputListener);
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);

		const selection = document.getSelection();
		expect(getHandled()).toBe(true);
		expect(titleEl.textContent).toBe("Examplemoved text");
		expect(selection?.anchorNode).toBe(titleEl.lastChild);
		expect(selection?.anchorOffset).toBe(0);
		expect(inputListener).toHaveBeenCalledTimes(1);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"",
			{ line: 0, ch: 0 },
			{ line: 1, ch: 0 },
		);
	});

	it("clears the only editor line after moving its text to the title", () => {
		const { titleEl, editorContentEl, editor } = createHarness(["moved text"]);
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);

		expect(titleEl.textContent).toBe("Examplemoved text");
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"",
			{ line: 0, ch: 0 },
			{ line: 0, ch: 10 },
		);
	});

	it("does not handle Backspace after the first editor position", () => {
		const { titleEl, editorContentEl, getHandled } = createHarness(
			["existing text"],
			{ cursor: { line: 0, ch: 1 } },
		);
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);

		expect(getHandled()).toBe(false);
		expect(document.activeElement).not.toBe(titleEl);
	});

	it("does not handle Backspace while editor text is selected", () => {
		const { titleEl, editorContentEl, getHandled } = createHarness([""], {
			hasSelection: true,
		});
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
		);

		expect(getHandled()).toBe(false);
		expect(document.activeElement).not.toBe(titleEl);
	});
});

describe("handleMarkdownEditorPageUp", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		document.getSelection()?.removeAllRanges();
	});

	it("moves the caret from any editor position to the title start", () => {
		const { titleEl, editorContentEl, getHandled } = createHarness(
			["first line", "second line"],
			{ cursor: { line: 1, ch: 5 } },
		);
		editorContentEl.focus();
		const event = new KeyboardEvent("keydown", {
			key: "PageUp",
			bubbles: true,
			cancelable: true,
		});

		editorContentEl.dispatchEvent(event);

		const selection = document.getSelection();
		expect(getHandled()).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(titleEl);
		expect(selection?.anchorNode).toBe(titleEl);
		expect(selection?.anchorOffset).toBe(0);
	});

	it("keeps modified PageUp available to the editor", () => {
		const { titleEl, editorContentEl, getHandled } = createHarness([""]);
		editorContentEl.focus();

		editorContentEl.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "PageUp",
				bubbles: true,
				shiftKey: true,
			}),
		);

		expect(getHandled()).toBe(false);
		expect(document.activeElement).not.toBe(titleEl);
	});
});
