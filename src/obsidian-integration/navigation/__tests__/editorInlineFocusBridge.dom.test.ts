// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { focusInlineSearchInputFromEditor } from "../editorInlineFocusBridge";

type FakeEditorView = {
	dom: HTMLElement;
	state: {
		doc: {
			lines: number;
			lineAt: (offset: number) => { number: number };
		};
		selection: {
			main: {
				empty: boolean;
				head: number;
			};
		};
	};
};

function createInlineSurface(): HTMLElement {
	const root = document.createElement("div");
	root.className = "cosense-card-links__root";
	root.dataset.cclCardSurface = "editor";

	const input = document.createElement("input");
	input.className = "twohop-search-input";
	root.append(input);

	return root;
}

function createEditorView({
	line = 2,
	lines = 2,
	empty = true,
}: {
	line?: number;
	lines?: number;
	empty?: boolean;
} = {}): FakeEditorView {
	const dom = document.createElement("div");
	const sourceView = document.createElement("div");
	sourceView.className = "markdown-source-view";
	const scroller = document.createElement("div");
	scroller.className = "cm-scroller";
	const inlineRoot = createInlineSurface();

	scroller.append(inlineRoot);
	sourceView.append(scroller);
	dom.append(sourceView);
	document.body.append(dom);

	return {
		dom,
		state: {
			doc: {
				lines,
				lineAt: () => ({ number: line }),
			},
			selection: {
				main: {
					empty,
					head: 10,
				},
			},
		},
	};
}

describe("focusInlineSearchInputFromEditor", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		vi.restoreAllMocks();
	});

	it("focuses the inline search input when the cursor is on the last line", () => {
		const view = createEditorView();
		const input = view.dom.querySelector<HTMLInputElement>(".twohop-search-input");
		const focusSpy = vi.spyOn(input!, "focus");

		const handled = focusInlineSearchInputFromEditor(view as never, () => true);

		expect(handled).toBe(true);
		expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
		expect(document.activeElement).toBe(input);
	});

	it("does not handle ArrowDown when the cursor is not on the last line", () => {
		const view = createEditorView({ line: 1, lines: 2 });
		const input = view.dom.querySelector<HTMLInputElement>(".twohop-search-input");
		const focusSpy = vi.spyOn(input!, "focus");

		const handled = focusInlineSearchInputFromEditor(view as never, () => true);

		expect(handled).toBe(false);
		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).not.toBe(input);
	});

	it("does not handle ArrowDown when there is a selection", () => {
		const view = createEditorView({ empty: false });
		const input = view.dom.querySelector<HTMLInputElement>(".twohop-search-input");
		const focusSpy = vi.spyOn(input!, "focus");

		const handled = focusInlineSearchInputFromEditor(view as never, () => true);

		expect(handled).toBe(false);
		expect(focusSpy).not.toHaveBeenCalled();
	});

	it("does not handle ArrowDown when the feature is disabled", () => {
		const view = createEditorView();
		const input = view.dom.querySelector<HTMLInputElement>(".twohop-search-input");
		const focusSpy = vi.spyOn(input!, "focus");

		const handled = focusInlineSearchInputFromEditor(view as never, () => false);

		expect(handled).toBe(false);
		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).not.toBe(input);
	});
});
