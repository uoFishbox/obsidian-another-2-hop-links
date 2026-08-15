import { TFile, type MetadataCache, type Vault, type Workspace } from "obsidian";
import type { App } from "obsidian";
import type { EventHandlers } from "types/services";
import type { IPreviewService } from "types/services";
import type {
	CachedMetadataWithLinkReferences,
	IIndexingService,
	TwoHopIndexedLink,
} from "types";
import type { HighlightMode, LinkContext, LinkInteractionOptions } from "./linkContext";
import type { PluginSettings } from "features/settings/model";
import { triggerHoverPopover } from "features/popover/mobilePopover";
import type { PluginHost } from "types/pluginHost";
import { shouldHighlight } from "ui/interactions/highlightUtils";
import { buildDragLinkFormat } from "application/presenters/linkHelper";
import { handleTagClick } from "ui/handlers/viewHandlers";
import {
	hydrateRuntimeBacklinkHoverLink,
	hydrateRuntimeBacklinkLink,
} from "./runtimeBacklinkPositionResolver";
import { isMouseEventLike } from "ui/shared/dom/realmSafeDom";

export function createLinkContextFactory(
	metadataCache: MetadataCache,
	eventHandlers: EventHandlers,
	indexingService: IIndexingService,
	vault: Vault,
	workspace: Workspace,
	plugin: PluginHost,
	app: App,
	previewService: IPreviewService,
) {
	const fileToLinktext = metadataCache.fileToLinktext.bind(metadataCache);
	return (file: TFile, settings: PluginSettings): LinkContext => {
		const dragLinkFormat = buildDragLinkFormat(file, fileToLinktext, app);
		const resolveHighlightEnabled = (
			event: MouseEvent | KeyboardEvent,
			options?: LinkInteractionOptions,
		): boolean => {
			const mode: HighlightMode = options?.highlightMode ?? "auto";
			if (mode === "force") {
				return true;
			}
			if (mode === "suppress") {
				return false;
			}
			return shouldHighlight(event, settings);
		};

		const getNewLeafOption = (
			event: MouseEvent | KeyboardEvent,
		): boolean | "tab" | "split" | "window" => {
			if (!isMouseEventLike(event)) {
				return false;
			}

			const ctrl = event.ctrlKey || event.metaKey;
			const alt = event.altKey;
			const shift = event.shiftKey;
			const middleClick = event.button === 1;

			// Shift+Alt+Ctrl で新しいウィンドウで開く
			if (shift && alt && ctrl) {
				return "window";
			}
			if (middleClick) {
				return "tab";
			}
			if (ctrl && alt) {
				return "split";
			}
			if (ctrl) {
				return "tab";
			}
			return false;
		};
		const linkContext: Partial<LinkContext> = {
			getPreview: (fileToLoad, signal, options) =>
				previewService.getPreview(fileToLoad, signal, options),
			resolveFile: eventHandlers.handleResolveFile,
			buildWikiLink: (targetFile: TFile | null, fallback: string) =>
				targetFile ? dragLinkFormat(targetFile) : `[[${fallback}]]`,
			getMetadata: eventHandlers.handleGetMetadata,
			onOpenFile: (event, f, pos, options) =>
				eventHandlers.handleOpenFile(
					f,
					resolveHighlightEnabled(event, options) ? pos : undefined,
					getNewLeafOption(event),
				),
			onHop2Click: (event, link, options) => {
				const highlight = resolveHighlightEnabled(event, options);
				const hydratedLink = options?.preferredPosition
					? {
							...link,
							position: options.preferredPosition,
						}
					: hydrateRuntimeBacklinkLink(
							metadataCache.getFileCache(
								link.sourceFile,
							) as CachedMetadataWithLinkReferences | null,
							link,
							metadataCache,
						);
				eventHandlers.handleOpenFile(
					link.sourceFile,
					highlight ? hydratedLink.position : undefined,
					getNewLeafOption(event),
					options?.preferredPosition ? undefined : hydratedLink.key,
				);
			},
			onLinkHover: (event, link, targetFile, isOutgoingLink, options) => {
				const hydratedLink = options?.preferredPosition
					? { ...link, position: options.preferredPosition }
					: hydrateRuntimeBacklinkHoverLink(
							metadataCache.getFileCache(
								link.sourceFile,
							) as CachedMetadataWithLinkReferences | null,
							link,
							metadataCache,
						);
				return triggerHoverPopover(
					workspace,
					plugin,
					event,
					hydratedLink,
					targetFile,
					settings,
					isOutgoingLink,
					options?.highlightMode,
				);
			},
			sourceFile: file,
			fileToLinktext: fileToLinktext,
			onShowFileMenu: eventHandlers.handleShowFileMenu,
		};
		linkContext.onHop1Click = (event, link, options) => {
			if (link.isUnresolved) {
				const newLeaf = getNewLeafOption(event);
				void app.workspace.openLinkText(link.rawText, file.path, newLeaf);
				return;
			}

			const newLeafOption = getNewLeafOption(event);

			const highlight = resolveHighlightEnabled(event, options);
			if (options?.preferredPosition && link.path) {
				const targetFile = eventHandlers.handleResolveFile(link.path);
				if (targetFile) {
					eventHandlers.handleOpenFile(
						targetFile,
						highlight ? options.preferredPosition : undefined,
						newLeafOption,
						undefined,
					);
					return;
				}
			}

			let linkToOpen: TwoHopIndexedLink = link;

			if (
				!highlight &&
				(link.rawText.includes("#") || link.rawText.includes("^"))
			) {
				linkToOpen = { ...link };
				const hashIndex = linkToOpen.rawText.indexOf("#");
				if (hashIndex !== -1) {
					linkToOpen.rawText = linkToOpen.rawText.substring(0, hashIndex);
				}
				const caretIndex = linkToOpen.rawText.indexOf("^");
				if (caretIndex !== -1) {
					linkToOpen.rawText = linkToOpen.rawText.substring(0, caretIndex);
				}
			}

			eventHandlers.handleOpenLinkDestination(linkToOpen, file, newLeafOption);
		};

		linkContext.onTagClick = (tag: string) =>
			void handleTagClick(
				tag,
				linkContext as LinkContext,
				indexingService,
				plugin,
			);

		return linkContext as LinkContext;
	};
}
