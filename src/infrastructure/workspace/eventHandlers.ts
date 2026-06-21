import {
	Menu,
	TFile,
	type Pos,
	type CachedMetadata,
	type Vault,
	type MetadataCache,
	type Workspace,
} from "obsidian";
import type { EventHandlers } from "types/services";
import * as ErrorHandler from "utils/errorHandler";
import type { TwoHopIndexedLink } from "types";
import { openFile, openLinkDestination } from "./fileOpener";
import { resolveFileByPath } from "infrastructure/utils/vaultUtils";

export const createEventHandlers = (
	metadataCache: MetadataCache,
	vault: Vault,
	workspace: Workspace,
): EventHandlers => {
	const handleOpenLinkDestination = (
		link: TwoHopIndexedLink,
		sourceFile: TFile,
		newLeaf: boolean | "tab" | "split" | "window" = false,
	): void => {
		try {
			openLinkDestination(workspace, link, sourceFile, newLeaf);
		} catch (error) {
			ErrorHandler.handleLinkResolutionError(error, link.rawText);
		}
	};

	const handleOpenFile = (
		file: TFile,
		position?: Pos,
		newLeaf: boolean | "tab" | "split" | "window" = false,
		key?: string,
	): void => {
		try {
			openFile(workspace, file, position, newLeaf, key);
		} catch (error) {
			ErrorHandler.handleFileOperationError(error, "openFile", file.path);
		}
	};

	const handleGetFileContent = async (file: TFile): Promise<string> => {
		try {
			if (file.extension !== "md") {
				return "";
			}
			return await vault.cachedRead(file);
		} catch (error) {
			ErrorHandler.handleFileOperationError(
				error,
				"cachedRead",
				file.path,
			);
			return "";
		}
	};

	const handleResolveFile = (path: string): TFile | null => {
		try {
			return resolveFileByPath(vault, path);
		} catch (error) {
			ErrorHandler.handleLinkResolutionError(error, path);
			return null;
		}
	};

	const handleGetMetadata = (file: TFile): CachedMetadata | null => {
		return metadataCache.getFileCache(file);
	};

	const handleShowFileMenu = (event: MouseEvent, file: TFile): void => {
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
			ErrorHandler.handleFileOperationError(
				error,
				"showFileMenu",
				file.path,
			);
		}
	};

	return {
		handleOpenLinkDestination,
		handleOpenFile,
		handleGetFileContent,
		handleResolveFile,
		handleGetMetadata,
		handleShowFileMenu,
	};
};
