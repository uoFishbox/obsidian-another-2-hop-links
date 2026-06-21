import { TFile, type App } from "obsidian";

export function buildDragLinkFormat(
	sourceFile: TFile,
	fileToLinktext: (file: TFile, sourcePath: string) => string,
	app: App,
): (targetFile: TFile) => string {
	return (targetFile: TFile) => {
		const linkText = fileToLinktext(targetFile, sourceFile.path);
		const useMarkdownLinks = app.vault.getConfig("useMarkdownLinks") as boolean;
		if (useMarkdownLinks) {
			return `[${targetFile.basename}](${linkText})`;
		}
		return `[[${linkText}]]`;
	};
}
