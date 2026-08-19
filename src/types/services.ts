import type { TFile, MarkdownView } from "obsidian";
import type { BacklinksMap, IndexedLinkQueryResult, TaggedNote } from "./domain";
import type {
	PreviewData,
	PreviewRequestOptions,
} from "features/card-preview/public-types";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";

export interface ILinkStatusService {
	generateLookupPath(linkText: string, sourceFile?: TFile): string;
	normalizeHref(href: string): string;
	extractHref(linkEl: HTMLElement): string | undefined;
	shouldDecorateLink(lookupPath: string): boolean;
	shouldDecorateLinkBatch(lookupPaths: Iterable<string>): Map<string, boolean>;
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;
}

export interface IIndexingService {
	getBacklinksMap(): BacklinksMap;
	invalidateAll(): void;
	getSourcePathsForLookupKeys(lookupKeys: Iterable<string>): Set<string>;
	getBacklinksForLink(linkPath: string): IndexedLinkQueryResult;
	getUniqueBacklinkSourcesForLink(
		linkPath: string,
		excludePath?: string,
		limit?: number,
	): IndexedLinkQueryResult;
	getBacklinkCountForLink(linkPath: string): number;
	hasAtLeastUniqueBacklinkSources(
		linkPath: string,
		minCount: number,
		options?: {
			excludePath?: string;
			requireExistingSourceFile?: boolean;
		},
	): boolean;
	getIndexVersion(): number;
	peekNotesWithCommonTags(file: TFile): TaggedNote[];
	getNotesWithTag(tag: string, sourcePath?: string): Promise<TaggedNote[]>;
	peekNotesWithTag(tag: string, sourcePath?: string): TaggedNote[];
	awaitIdle(): Promise<void>;
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;
	isUnresolvedWithSingleBacklinkBatch(lookupPaths: string[]): Map<string, boolean>;
	onDataUpdate(listener: (context: DataUpdateContext) => void): () => void;
}

export interface PreviewQueueMetrics {
	readonly queued: number;
	readonly active: number;
}

export interface IPreviewService {
	getPreview(
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	): Promise<PreviewData>;
	getVisibleQueueSize(): number;
	getActiveVisiblePreviewCount(): number;
	getOutstandingVisiblePreviewCount(): number;
	subscribeVisiblePreviewQueue(
		listener: (metrics: PreviewQueueMetrics) => void,
	): () => void;
}

export interface IComponentManager {
	mountComponentsForView(
		view: MarkdownView,
		file: TFile | undefined,
		options?: {
			skipIfMounted?: boolean;
		},
	): void;
	unmountViewComponents(view: MarkdownView): void;
	destroy(): void;
}
