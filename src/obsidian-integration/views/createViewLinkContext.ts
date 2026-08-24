import type { TFile, Pos } from "obsidian";
import type { LinkContext, LinkInteractionOptions } from "cards/context/linkContext";

export function createViewLinkContext(
	originalLinkContext: LinkContext,
	closeView: () => void,
): LinkContext {
	const originalOnOpenFile = originalLinkContext.onOpenFile;
	originalLinkContext.onOpenFile = (
		event: MouseEvent | KeyboardEvent,
		file: TFile,
		position?: Pos,
		options?: LinkInteractionOptions,
	) => {
		originalOnOpenFile(event, file, position, options);
		closeView();
	};
	return originalLinkContext;
}
