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
	length: number;
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
	hop1: TwoHopIndexedLink;
	hop2: TwoHopIndexedLink[];
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
	tag: string;
	notes: TaggedNote[];
}

export interface DisplayDataVersions {
	links: string;
	tags: string;
}

export interface TwoHopLinkResult {
	/**
	 * 起点のファイル
	 */
	originFile: TFile;
	/**
	 * 起点ファイルから辿れる1ホップ目のリンクと、それに紐づく2ホップ目のリンク
	 */
	branches: TwoHopLinkBranch[];
	/**
	 * originFileに向かうバックリンク
	 */
	backlinks: TwoHopIndexedLink[];
	/**
	 * originFileと共通タグを持つノート
	 */
	taggedNotes: TaggedNote[];
	/**
	 * UI の display preprocessing を O(1) 判定で更新するための比較トークン
	 */
	displayVersions?: DisplayDataVersions;
}

export type ResolvePhase = "base" | "twohop" | "complete";

export interface ResolveProgress {
	phase: ResolvePhase;
	data: TwoHopLinkResult;
}
