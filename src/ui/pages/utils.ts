import type { TFile, Pos } from "obsidian";
import type {
	LinkContext,
	LinkInteractionOptions,
} from "ui/context/linkContext";

export function createViewLinkContext(
	originalLinkContext: LinkContext,
	closeView: () => void,
): LinkContext {
	return {
		...originalLinkContext,
		onOpenFile: (
			event: MouseEvent | KeyboardEvent,
			file: TFile,
			position?: Pos,
			options?: LinkInteractionOptions,
		) => {
			originalLinkContext.onOpenFile(event, file, position, options);
			closeView();
		},
	};
}
