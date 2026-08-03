import type { TFile, MarkdownView, Pos, CachedMetadata } from "obsidian";
import type {
	BacklinksMap,
	IndexedLinkQueryResult,
	TaggedNote,
	TwoHopLinkBranch,
	TwoHopIndexedLink,
} from "./domain";
import type { DedupResult, DedupState } from "./deduplication";
import type { SortOption } from "features/settings/model";
import type { SortableItem } from "core/sorting/types";
import type { PreviewData, PreviewRequestOptions } from "features/preview/public-types";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";

/**
 * ILinkStatusService
 *
 * リンク状態の判定を行うサービスのインターフェース。
 * 未解決リンク判定、シングルバックリンク判定、装飾可否判定を提供する。
 */
export interface ILinkStatusService {
	/**
	 * リンクテキストからlookupPath（正規化されたパス）を生成
	 */
	generateLookupPath(linkText: string, sourceFile?: TFile): string;

	/**
	 * href属性からパス部分を抽出（#以降のアンカー部分を除去）
	 */
	normalizeHref(href: string): string;

	/**
	 * DOM要素からhref情報を抽出
	 */
	extractHref(linkEl: HTMLElement): string | undefined;

	/**
	 * 指定されたlookupPathが装飾対象かどうかを判定（設定考慮済み）
	 */
	shouldDecorateLink(lookupPath: string): boolean;

	/**
	 * 複数のlookupPathをバッチで判定
	 */
	shouldDecorateLinkBatch(lookupPaths: Iterable<string>): Map<string, boolean>;

	/**
	 * 指定されたlookupPathが未解決リンクかつシングルバックリンクかを判定
	 * （設定を考慮しない低レベルAPI）
	 */
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;

	/**
	 * キャッシュを無効化
	 */
	invalidateCache(): void;
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
	getIndexVersion(): number;
	peekNotesWithCommonTags(file: TFile): TaggedNote[];
	getNotesWithCommonTags(file: TFile): Promise<TaggedNote[]>;
	getNotesWithTag(tag: string, sourcePath?: string): Promise<TaggedNote[]>;
	peekNotesWithTag?(tag: string, sourcePath?: string): TaggedNote[];
	awaitIdle(): Promise<void>;
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;
	isUnresolvedWithSingleBacklinkBatch(lookupPaths: string[]): Map<string, boolean>;
	onDataUpdate?(listener: (context: DataUpdateContext) => void): () => void;
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

export type SortMetricKind =
	| "displayName"
	| "outgoingLinkCount"
	| "createdTime"
	| "modifiedTime"
	| "backlinkCount"
	| "fileSize";

export interface IMetricProvider {
	getDisplayName(item: SortableItem): string;
	getOutgoingLinkCount(item: SortableItem): number;
	getCreatedTime(item: SortableItem): number;
	getModifiedTime(item: SortableItem): number;
	getBacklinkCount(item: SortableItem): number;
	getFileSize(item: SortableItem): number;
	/**
	 * Returns the stable object identity shared by items whose metric value
	 * can be reused until the sort cache is invalidated.
	 */
	getMetricCacheIdentity?(
		metricKind: SortMetricKind,
		item: SortableItem,
	): object | undefined;
}

export interface ISortService {
	sort<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): readonly T[];
	sortWithResult?<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): {
		items: readonly T[];
		orderChanged: boolean;
	};
}

export interface IDeduplicationService {
	collectUniqueBranches(
		state: DedupState,
		branches: readonly TwoHopLinkBranch[],
	): DedupResult<TwoHopLinkBranch>;
	collectUniqueBacklinks(
		state: DedupState,
		backlinks: readonly TwoHopIndexedLink[],
	): DedupResult<TwoHopIndexedLink>;
	buildFilteredTwoHopBranches(
		state: DedupState,
		branches: readonly TwoHopLinkBranch[],
	): DedupResult<TwoHopLinkBranch>;
	collectUniqueTaggedNotes(
		state: DedupState,
		taggedNotes: readonly TaggedNote[],
	): DedupResult<TaggedNote>;
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

export interface EventHandlers {
	handleOpenLinkDestination: (
		link: TwoHopIndexedLink,
		sourceFile: TFile,
		newLeaf?: boolean | "tab" | "split" | "window",
	) => void;
	handleOpenFile: (
		file: TFile,
		position?: Pos,
		newLeaf?: boolean | "tab" | "split" | "window",
		key?: string,
	) => void;
	handleGetFileContent: (file: TFile) => Promise<string>;
	handleResolveFile: (path: string) => TFile | null;
	handleGetMetadata: (file: TFile) => CachedMetadata | null;
	handleShowFileMenu: (event: MouseEvent, file: TFile) => void;
}
