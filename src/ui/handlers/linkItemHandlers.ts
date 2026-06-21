import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type {
	LinkContext,
	LinkInteractionOptions,
} from "ui/context/linkContext";

export type LinkHandlerOptionsInput =
	| LinkInteractionOptions
	| (() => LinkInteractionOptions | undefined)
	| undefined;

function resolveHandlerOptions(
	options?: LinkHandlerOptionsInput,
): LinkInteractionOptions {
	const resolved = typeof options === "function" ? options() : options;
	return {
		highlightMode: resolved?.highlightMode ?? "auto",
		preferredPosition: resolved?.preferredPosition,
	};
}

export function dispatchItemClick(
	item: ViewItem,
	context: LinkContext,
	event: MouseEvent | KeyboardEvent,
	options?: LinkHandlerOptionsInput,
): void {
	const interactionOptions = resolveHandlerOptions(options);

	switch (item.type) {
		case "taggedNote": {
			const preferredPosition = interactionOptions.preferredPosition;
			context.onOpenFile(
				event,
				item.data.file,
				preferredPosition ?? item.data.position,
				interactionOptions,
			);
			return;
		}
		case "backlink":
			context.onHop2Click(event, item.data, interactionOptions);
			return;
		case "newLink":
			context.onHop1Click(event, item.data, interactionOptions);
			return;
		case "branch":
			context.onHop1Click(event, item.data.hop1, interactionOptions);
			return;
		case "file":
			context.onOpenFile(
				event,
				item.data,
				interactionOptions.preferredPosition,
				interactionOptions,
			);
			return;
		default:
			return;
	}
}

export function dispatchItemHover(
	item: ViewItem,
	context: LinkContext,
	targetFile: TFile | null,
	event: MouseEvent,
	options?: LinkHandlerOptionsInput,
): void {
	if (!targetFile) {
		return;
	}

	const interactionOptions = resolveHandlerOptions(options);

	switch (item.type) {
		case "taggedNote": {
			const preferredPosition = interactionOptions.preferredPosition;
			const linkData = {
				rawText: item.data.file.basename,
				path: item.data.path,
				sourceFile: item.data.file,
				isUnresolved: false,
				position: preferredPosition ?? item.data.position,
			};
			context.onLinkHover?.(
				event,
				linkData,
				targetFile,
				false,
				interactionOptions,
			);
			return;
		}
		case "branch": {
			const preferredPosition = interactionOptions.preferredPosition;
			const preferSearchMatch =
				interactionOptions.highlightMode === "force" &&
				!!preferredPosition;
			const linkData = preferSearchMatch
				? {
						...item.data.hop1,
						position: preferredPosition,
					}
				: item.data.hop1;
			context.onLinkHover?.(
				event,
				linkData,
				targetFile,
				preferSearchMatch ? false : true,
				interactionOptions,
			);
			return;
		}
		case "backlink": {
			const preferredPosition = interactionOptions.preferredPosition;
			const linkData = preferredPosition
				? {
						...item.data,
						position: preferredPosition,
					}
				: item.data;
			context.onLinkHover?.(
				event,
				linkData,
				targetFile,
				false,
				interactionOptions,
			);
			return;
		}
		case "newLink":
			return;
		case "file": {
			const preferredPosition = interactionOptions.preferredPosition;
			const linkData = {
				rawText: item.data.basename,
				path: item.data.path,
				sourceFile: item.data,
				isUnresolved: false,
				position: preferredPosition,
			};
			context.onLinkHover?.(
				event,
				linkData,
				targetFile,
				false,
				interactionOptions,
			);
			return;
		}
		default:
			return;
	}
}
