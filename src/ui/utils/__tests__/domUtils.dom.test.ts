import { beforeEach, describe, expect, it } from "vitest";
import type { MarkdownView } from "obsidian";
import { CONTAINER_CLASS } from "../../../appConstants";
import { getActiveInlineContainer } from "../domUtils";

function createView(mode: "source" | "preview"): MarkdownView {
	const containerEl = document.createElement("div");
	containerEl.innerHTML = `
		<div class="view-content">
			<div class="markdown-source-view">
				<div class="cm-editor"><div class="cm-scroller"></div></div>
			</div>
			<div class="markdown-reading-view">
				<div class="markdown-preview-view"></div>
			</div>
		</div>
	`;

	return {
		containerEl,
		getMode: () => mode,
	} as unknown as MarkdownView;
}

describe("getActiveInlineContainer", () => {
	beforeEach(() => {
		document.body.replaceChildren();
	});

	it("returns and initializes only the source surface in source mode", () => {
		const view = createView("source");

		const target = getActiveInlineContainer(view);

		expect(target?.surface).toBe("source");
		expect(target?.container.parentElement?.classList.contains("cm-scroller")).toBe(
			true,
		);
		expect(
			view.containerEl.querySelector(
				`.markdown-preview-view .${CONTAINER_CLASS}`,
			),
		).toBeNull();
	});

	it("returns and initializes only the preview surface in preview mode", () => {
		const view = createView("preview");

		const target = getActiveInlineContainer(view);

		expect(target?.surface).toBe("preview");
		expect(
			target?.container.parentElement?.classList.contains(
				"markdown-preview-view",
			),
		).toBe(true);
		expect(
			view.containerEl.querySelector(`.cm-scroller .${CONTAINER_CLASS}`),
		).toBeNull();
	});

	it("returns null when the active surface DOM is not ready", () => {
		const view = createView("preview");
		view.containerEl.querySelector(".markdown-reading-view")?.remove();

		const target = getActiveInlineContainer(view);

		expect(target).toBeNull();
		expect(
			view.containerEl.querySelector(`.cm-scroller .${CONTAINER_CLASS}`),
		).toBeNull();
	});
});
