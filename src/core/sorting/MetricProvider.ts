import { TFile } from "obsidian";
import type {
	CachedMetadataWithLinkReferences,
	TwoHopLinkBranch,
	TwoHopIndexedLink,
	TaggedNote,
} from "types/domain";
import type {
	IMetricProvider,
	SortingConfiguration,
	SortableItem,
	SortMetricKind,
} from "./types";
import { countLinkReferences } from "core/indexing/metadata/metadataExtractor";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import type { IIndexingService } from "types/services";
import type { IMetadataCache, IVault } from "types/obsidian";
import { resolveFrontmatterDate } from "./frontmatterDate";
import {
	getPriorityFrontmatterCardTitle,
	resolveFileCardTitle,
} from "core/frontmatterCardTitle";

export function isBranch(item: SortableItem): item is TwoHopLinkBranch {
	return "hop1" in item && "hop2" in item;
}

export function isBacklink(item: SortableItem): item is TwoHopIndexedLink {
	return !isBranch(item) && "sourceFile" in item;
}

export function isTaggedNote(item: SortableItem): item is TaggedNote {
	return "file" in item && "commonTags" in item;
}

export class MetricProvider implements IMetricProvider {
	private readonly getFileMetadata = (file: TFile) =>
		this.metadataCache.getFileCache(file);

	constructor(
		private metadataCache: IMetadataCache,
		private vault: IVault,
		private indexingService: IIndexingService,
		private getConfiguration: () => SortingConfiguration,
	) {}

	getDisplayName(item: SortableItem): string {
		const configuration = this.getConfiguration();
		const titleKey = configuration.priorityFrontmatterKeyForTitle?.trim();

		if (isBranch(item)) {
			const targetFile = this.getTargetFile(item);
			if (!targetFile) {
				return item.hop1.rawText || "";
			}

			return resolveFileCardTitle(
				targetFile,
				item.hop1.sourceFile.path,
				this.metadataCache.fileToLinktext.bind(this.metadataCache),
				this.getFileMetadata,
				configuration.priorityFrontmatterKeyForTitle,
			);
		}

		if (titleKey) {
			const targetFile = this.getTargetFile(item);
			const frontmatterTitle = getPriorityFrontmatterCardTitle(
				targetFile,
				titleKey,
				this.getFileMetadata,
			);

			if (frontmatterTitle) {
				return frontmatterTitle;
			}
		}

		if (isBacklink(item)) {
			return item.sourceFile.basename;
		}
		if (isTaggedNote(item)) {
			return item.file.basename;
		}
		if (item instanceof TFile) {
			return item.basename;
		}
		return "";
	}

	getOutgoingLinkCount(item: SortableItem): number {
		const file = this.getTargetFile(item);
		if (!file) return 0;

		const cache = this.metadataCache.getFileCache(
			file,
		) as CachedMetadataWithLinkReferences | null;
		return countLinkReferences(cache);
	}

	getCreatedTime(item: SortableItem): number {
		const file = this.getTargetFile(item);
		if (!file) return 0;

		const configuration = this.getConfiguration();
		if (configuration.frontmatterKeyCreatedDate) {
			const fmDate = this.getDateFromFrontmatter(
				file,
				configuration.frontmatterKeyCreatedDate,
			);
			if (fmDate !== null) return fmDate;
		}

		return file.stat.ctime;
	}

	getModifiedTime(item: SortableItem): number {
		const file = this.getTargetFile(item);
		if (!file) return 0;

		const configuration = this.getConfiguration();
		if (configuration.frontmatterKeyModifiedDate) {
			const fmDate = this.getDateFromFrontmatter(
				file,
				configuration.frontmatterKeyModifiedDate,
			);
			if (fmDate !== null) return fmDate;
		}

		return file.stat.mtime;
	}

	getBacklinkCount(item: SortableItem): number {
		const file = this.getTargetFile(item);
		if (!file) return 0;
		return this.indexingService.getBacklinkCountForLink(file.path);
	}

	getFileSize(item: SortableItem): number {
		const file = this.getTargetFile(item);
		if (!file) return 0;
		return file.stat.size;
	}

	getMetricCacheIdentity(
		metricKind: SortMetricKind,
		item: SortableItem,
	): TFile | undefined {
		if (metricKind === "displayName" && isBranch(item)) {
			return undefined;
		}

		return this.getTargetFile(item);
	}

	private getTargetFile(item: SortableItem): TFile | undefined {
		if (isBranch(item)) {
			if (!item.hop1.path) return undefined;
			return resolveFileByPath(this.vault, item.hop1.path) ?? undefined;
		}
		if (isBacklink(item)) {
			return item.sourceFile;
		}
		if (isTaggedNote(item)) {
			return item.file;
		}
		if (item instanceof TFile) {
			return item;
		}
		return undefined;
	}

	private getDateFromFrontmatter(file: TFile, key: string): number | null {
		return resolveFrontmatterDate(this.metadataCache, file, key);
	}
}
