import type {
	TFile,
	LinkCache,
	FrontMatterCache,
	CachedMetadata,
	ReferenceCache,
	CacheItem,
	Pos,
} from "obsidian";

export interface FrontMatterLinkReference extends Omit<
	ReferenceCache,
	keyof CacheItem
> {
	key: string;
}

export type LinkReference = LinkCache | FrontMatterLinkReference;

export type CachedMetadataWithLinkReferences = CachedMetadata & {
	frontmatterLinks?: FrontMatterLinkReference[];
};

export interface TwoHopIndexedLink {
	rawText: string;
	path: string | undefined;
	lookupPath?: string;
	displayText?: string;
	isUnresolved: boolean;
	sourceFile: TFile;
	position?: Pos;
	backlinkCount?: number;
	key?: string;
}

export type IndexedLinkQueryResult = readonly Readonly<TwoHopIndexedLink>[];

export interface BacklinkBucket {
	count: number;
	hasResolved: boolean;
}

export type BacklinkSourceMap = Map<string, BacklinkBucket>;

export type BacklinksMap = Map<string, BacklinkSourceMap>;

export interface IndexedFile {
	file: TFile;
	path: string;
	basename: string;
	aliases: string[];
	tags: string[];
	links: TwoHopIndexedLink[];
	frontMatter?: FrontMatterCache;
}

export interface LinkResolution {
	file: TFile | null;
	lookupPath: string;
	isUnresolved: boolean;
}

export interface TwoHopLinkBranch {
	readonly hop1: TwoHopIndexedLink;
	readonly hop2: IndexedLinkQueryResult;
}

export interface TagReference {
	tag: string;
	position?: Pos; // フロントマターのタグは位置情報がないためオプショナル
}

export interface TaggedNote {
	file: TFile;
	commonTags: string[];
	path: string;
	usageKey?: string;
	position?: Pos; // 最初に一致した共通タグの位置情報
}

export interface TagGroup {
	readonly tag: string;
	readonly notes: readonly TaggedNote[];
}

export interface TwoHopLinkResult {
	/**
	 * 起点のファイル
	 */
	readonly originFile: TFile;
	/**
	 * 起点ファイルから辿れる1ホップ目のリンクと、それに紐づく2ホップ目のリンク
	 */
	readonly branches: readonly Readonly<TwoHopLinkBranch>[];
	/**
	 * originFileに向かうバックリンク
	 */
	readonly backlinks: IndexedLinkQueryResult;
	/**
	 * originFileと共通タグを持つノート
	 */
	readonly taggedNotes: readonly Readonly<TaggedNote>[];
}

export type ResolvePhase = "base" | "twohop" | "complete";

export interface ResolveProgress {
	phase: ResolvePhase;
	data: TwoHopLinkResult;
}
