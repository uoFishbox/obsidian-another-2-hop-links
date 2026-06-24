import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type { LinkContext, LinkInteractionOptions } from "ui/context/linkContext";

export function dispatchItemClick(
	item: ViewItem,
	context: LinkContext,
	event: MouseEvent | KeyboardEvent,
	options?: LinkInteractionOptions,
): void {
	switch (item.type) {
		case "taggedNote": {
			context.onOpenFile(
				event,
				item.data.file,
				options?.preferredPosition ?? item.data.position,
				options,
			);
			return;
		}
		case "backlink":
			context.onHop2Click(event, item.data, options);
			return;
		case "newLink":
			context.onHop1Click(event, item.data, options);
			return;
		case "branch":
			context.onHop1Click(event, item.data.hop1, options);
			return;
		case "file":
			context.onOpenFile(event, item.data, options?.preferredPosition, options);
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
	options?: LinkInteractionOptions,
): void {
	if (!targetFile) {
		return;
	}

	switch (item.type) {
		case "taggedNote": {
			context.onLinkHover?.(
				event,
				{
					rawText: item.data.file.basename,
					path: item.data.path,
					sourceFile: item.data.file,
					isUnresolved: false,
					position: options?.preferredPosition ?? item.data.position,
				},
				targetFile,
				false,
				options,
			);
			return;
		}
		case "branch": {
			// handler manages preferredPosition spread; pass hop1 directly
			const preferSearchMatch =
				options?.highlightMode === "force" && !!options?.preferredPosition;
			context.onLinkHover?.(
				event,
				item.data.hop1,
				targetFile,
				preferSearchMatch ? false : true,
				options,
			);
			return;
		}
		case "backlink": {
			// handler manages preferredPosition spread; pass item.data directly
			context.onLinkHover?.(event, item.data, targetFile, false, options);
			return;
		}
		case "newLink":
			return;
		case "file": {
			context.onLinkHover?.(
				event,
				{
					rawText: item.data.basename,
					path: item.data.path,
					sourceFile: item.data,
					isUnresolved: false,
					position: options?.preferredPosition,
				},
				targetFile,
				false,
				options,
			);
			return;
		}
		default:
			return;
	}
}
