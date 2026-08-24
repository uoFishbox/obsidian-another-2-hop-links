import type {
	CacheItem,
	CachedMetadata,
	FrontMatterCache,
	LinkCache,
	Pos,
	ReferenceCache,
	TFile,
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

export interface IndexedLink {
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

export type IndexedLinkQueryResult = readonly Readonly<IndexedLink>[];

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
	links: IndexedLink[];
	frontMatter?: FrontMatterCache;
}

export interface LinkResolution {
	file: TFile | null;
	lookupPath: string;
	isUnresolved: boolean;
}

export interface TagReference {
	tag: string;
	position?: Pos;
}

export interface TaggedNote {
	file: TFile;
	commonTags: string[];
	path: string;
	usageKey?: string;
	position?: Pos;
}
