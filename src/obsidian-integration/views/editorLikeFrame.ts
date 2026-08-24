type FrameOptions = {
	title: string;
	extraWrapperClasses?: string[];
};

export type EditorLikeFrame = {
	wrapperEl: HTMLDivElement;
	scrollerEl: HTMLDivElement;
	sizerEl: HTMLDivElement;
	titleEl: HTMLDivElement;
	infoEl: HTMLDivElement;
	contentEl: HTMLDivElement;
};

export function buildEditorLikeFrame(
	containerEl: HTMLElement,
	options: FrameOptions,
): EditorLikeFrame {
	const wrapperClasses = [
		"markdown-source-view",
		"cm-s-obsidian",
		"mod-cm6",
		"is-readable-line-width",
		...(options.extraWrapperClasses ?? []),
	].join(" ");
	const wrapperEl = containerEl.createDiv({
		cls: wrapperClasses,
	});
	const editorEl = wrapperEl.createDiv({ cls: "cm-editor" });
	const scrollerEl = editorEl.createDiv({ cls: "cm-scroller" });
	const sizerEl = scrollerEl.createDiv({ cls: "cm-sizer" });

	const titleEl = sizerEl.createDiv({ cls: "inline-title" });
	titleEl.textContent = options.title;

	const infoEl = sizerEl.createDiv({
		cls: "cosense-card-links-pre-create__info",
	});

	const contentContainerEl = sizerEl.createDiv({
		cls: "cm-contentContainer",
	});
	const contentEl = contentContainerEl.createDiv({
		cls: "cm-content cm-lineWrapping",
	});
	contentEl.setAttribute("role", "textbox");
	contentEl.setAttribute("aria-multiline", "true");
	const lineEl = contentEl.createDiv({ cls: "cm-line" });
	lineEl.createEl("br");

	return {
		wrapperEl,
		scrollerEl,
		sizerEl,
		titleEl,
		infoEl,
		contentEl,
	};
}
