import { TFile } from "obsidian";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { PluginSettings } from "types/settings";
import {
	normalizeLinkToMarkdownPath,
	stripLinkAnchor,
} from "core/indexing/link-resolution/linkResolution";
import { enableLogging, logger } from "utils/logger";

export interface LinkStatusService {
	invalidateCache(): void;
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
	const decorationCache = new Map<string, boolean>();
	let lastSettingValue: boolean | undefined;

	indexingService.onDataUpdate(() => {
		invalidateCache();
	});

	function invalidateCache(): void {
		decorationCache.clear();
		if (enableLogging) logger(`[LinkStatusService] Cache invalidated`);
	}

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
		if (!refreshCacheForCurrentSetting()) {
			return false;
		}

		const cached = decorationCache.get(lookupPath);
		if (cached !== undefined) {
			return cached;
		}

		const result = indexingService.isUnresolvedWithSingleBacklink(lookupPath);
		decorationCache.set(lookupPath, result);
		return result;
	}

	function shouldDecorateLinkBatch(
		lookupPaths: Iterable<string>,
	): Map<string, boolean> {
		if (!refreshCacheForCurrentSetting()) {
			return new Map();
		}

		const results = new Map<string, boolean>();
		const { uncachedPaths, totalCount } = collectUncachedPaths(
			lookupPaths,
			results,
		);

		if (uncachedPaths.length > 0) {
			cacheBatchResults(uncachedPaths, results);
		}

		if (enableLogging) {
			logger(
				`[LinkStatusService] Batch check: ${totalCount} total, ${
					totalCount - uncachedPaths.length
				} cached, ${uncachedPaths.length} queried`,
			);
		}

		return results;
	}

	function isUnresolvedWithSingleBacklink(lookupPath: string): boolean {
		return indexingService.isUnresolvedWithSingleBacklink(lookupPath);
	}

	function refreshCacheForCurrentSetting(): boolean {
		const currentSetting = getSettings().enableUnresolvedLinkDecoration;
		if (lastSettingValue !== currentSetting) {
			lastSettingValue = currentSetting;
			decorationCache.clear();
		}

		return currentSetting;
	}

	function collectUncachedPaths(
		lookupPaths: Iterable<string>,
		results: Map<string, boolean>,
	): { uncachedPaths: string[]; totalCount: number } {
		const uncachedPaths: string[] = [];
		let totalCount = 0;
		for (const path of lookupPaths) {
			totalCount++;
			const cached = decorationCache.get(path);
			if (cached !== undefined) {
				results.set(path, cached);
				continue;
			}

			uncachedPaths.push(path);
		}

		return { uncachedPaths, totalCount };
	}

	function cacheBatchResults(
		lookupPaths: string[],
		results: Map<string, boolean>,
	): void {
		const batchResults =
			indexingService.isUnresolvedWithSingleBacklinkBatch(lookupPaths);
		for (const [path, value] of batchResults) {
			decorationCache.set(path, value);
			results.set(path, value);
		}
	}

	return {
		invalidateCache,
		generateLookupPath,
		normalizeHref,
		extractHref,
		isDecorationEnabled,
		shouldDecorateLink,
		shouldDecorateLinkBatch,
		isUnresolvedWithSingleBacklink,
	};
}
