import { Menu, TFile, type MetadataCache, type Vault, type Workspace } from "obsidian";
import type { App } from "obsidian";
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
import { openFile, openLinkDestination } from "infrastructure/workspace/fileOpener";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import * as ErrorHandler from "shared/errors/errorHandler";

export function createLinkContextFactory(
	metadataCache: MetadataCache,
	indexingService: IIndexingService,
	vault: Vault,
	workspace: Workspace,
	plugin: PluginHost,
	app: App,
	previewService: IPreviewService,
) {
	const fileToLinktext = metadataCache.fileToLinktext.bind(metadataCache);
	const resolveFile = (path: string): TFile | null => {
		try {
			return resolveFileByPath(vault, path);
		} catch (error) {
			ErrorHandler.handleLinkResolutionError(error, path);
			return null;
		}
	};
	const showFileMenu = (event: MouseEvent, file: TFile): void => {
		try {
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle("Open in new tab")
					.setIcon("file-plus")
					.setSection("open")
					.onClick(() => {
						void openFile(workspace, file, undefined, "tab");
					});
			});
			workspace.trigger("file-menu", menu, file);
			menu.showAtMouseEvent(event);
		} catch (error) {
			ErrorHandler.handleFileOperationError(error, "showFileMenu", file.path);
		}
	};
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
			resolveFile,
			buildWikiLink: (targetFile: TFile | null, fallback: string) =>
				targetFile ? dragLinkFormat(targetFile) : `[[${fallback}]]`,
			getMetadata: (targetFile) => metadataCache.getFileCache(targetFile),
			onOpenFile: (event, f, pos, options) => {
				void openFile(
					workspace,
					f,
					resolveHighlightEnabled(event, options) ? pos : undefined,
					getNewLeafOption(event),
				);
			},
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
				void openFile(
					workspace,
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
			onShowFileMenu: showFileMenu,
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
				const targetFile = resolveFile(link.path);
				if (targetFile) {
					void openFile(
						workspace,
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

			void openLinkDestination(workspace, linkToOpen, file, newLeafOption);
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
