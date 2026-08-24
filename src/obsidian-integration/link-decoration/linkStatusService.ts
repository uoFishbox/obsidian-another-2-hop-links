import { TFile } from "obsidian";
import type { IndexingService } from "indexing/index-service/IndexingService";
import type { PluginSettings } from "settings/model";
import {
	normalizeLinkToMarkdownPath,
	stripLinkAnchor,
} from "indexing/link-resolution/linkResolution";

export interface LinkStatusService {
	generateLookupPath(linkText: string, sourceFile?: TFile): string;
	normalizeHref(href: string): string;
	extractHref(linkEl: HTMLElement): string | undefined;
	isDecorationEnabled(): boolean;
	shouldDecorateLink(lookupPath: string): boolean;
	shouldDecorateLinkBatch(lookupPaths: Iterable<string>): Map<string, boolean>;
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;
}

export function createLinkStatusService(
	indexingService: IndexingService,
	getSettings: () => PluginSettings,
): LinkStatusService {
	function generateLookupPath(linkText: string, _sourceFile?: TFile): string {
		return normalizeLinkToMarkdownPath(linkText);
	}

	function normalizeHref(href: string): string {
		return stripLinkAnchor(href);
	}

	function extractHref(linkEl: HTMLElement): string | undefined {
		const href =
			linkEl.getAttribute("data-href") ||
			linkEl.getAttribute("href") ||
			linkEl.textContent?.trim();
		return href || undefined;
	}

	function isDecorationEnabled(): boolean {
		return getSettings().enableUnresolvedLinkDecoration;
	}

	function shouldDecorateLink(lookupPath: string): boolean {
		if (!isDecorationEnabled()) {
			return false;
		}
		return indexingService.isUnresolvedWithSingleBacklink(lookupPath);
	}

	function shouldDecorateLinkBatch(
		lookupPaths: Iterable<string>,
	): Map<string, boolean> {
		if (!isDecorationEnabled()) {
			return new Map();
		}
		return indexingService.isUnresolvedWithSingleBacklinkBatch(
			Array.from(lookupPaths),
		);
	}

	function isUnresolvedWithSingleBacklink(lookupPath: string): boolean {
		return indexingService.isUnresolvedWithSingleBacklink(lookupPath);
	}

	return {
		generateLookupPath,
		normalizeHref,
		extractHref,
		isDecorationEnabled,
		shouldDecorateLink,
		shouldDecorateLinkBatch,
		isUnresolvedWithSingleBacklink,
	};
}
