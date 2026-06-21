import { describe, expect, it } from "vitest";
import { buildEditorLikeFrame } from "ui/views/shared/editorLikeFrame";

type DomOptions = {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
};

function applyDomHelpers<T extends HTMLElement>(el: T): T {
	(
		el as T & {
			createDiv: (options?: DomOptions) => HTMLDivElement;
			createEl: (tag: string, options?: DomOptions) => HTMLElement;
		}
	).createDiv = (options?: DomOptions): HTMLDivElement => {
		const child = applyDomHelpers(document.createElement("div"));
		if (options?.cls) {
			child.className = options.cls;
		}
		if (options?.text) {
			child.textContent = options.text;
		}
		if (options?.attr) {
			for (const [key, value] of Object.entries(options.attr)) {
				child.setAttribute(key, value);
			}
		}
		el.appendChild(child);
		return child;
	};

	(
		el as T & {
			createEl: (tag: string, options?: DomOptions) => HTMLElement;
		}
	).createEl = (tag: string, options?: DomOptions): HTMLElement => {
		const child = applyDomHelpers(document.createElement(tag));
		if (options?.cls) {
			child.className = options.cls;
		}
		if (options?.text) {
			child.textContent = options.text;
		}
		if (options?.attr) {
			for (const [key, value] of Object.entries(options.attr)) {
				child.setAttribute(key, value);
			}
		}
		el.appendChild(child);
		return child;
	};

	return el;
}

describe("buildEditorLikeFrame", () => {
	it("generates the skeleton of a pseudo markdown-source-view", () => {
		const container = applyDomHelpers(document.createElement("div"));

		const frame = buildEditorLikeFrame(container, {
			title: "Frame Title",
			extraWrapperClasses: ["extra-a", "extra-b"],
		});

		expect(frame.wrapperEl.className).toContain("markdown-source-view");
		expect(frame.wrapperEl.className).toContain("extra-a");
		expect(frame.wrapperEl.className).toContain("extra-b");
		expect(frame.scrollerEl.className).toBe("cm-scroller");
		expect(frame.sizerEl.className).toBe("cm-sizer");
		expect(frame.titleEl.textContent).toBe("Frame Title");
		expect(frame.infoEl.className).toBe("cosense-card-links-pre-create__info");
		expect(frame.contentEl.className).toBe("cm-content cm-lineWrapping");
		expect(frame.contentEl.getAttribute("role")).toBe("textbox");
		expect(frame.contentEl.getAttribute("aria-multiline")).toBe("true");
		expect(frame.contentEl.querySelector(".cm-line br")).not.toBeNull();
	});
});
