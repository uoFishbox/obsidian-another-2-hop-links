export type {
	FrontMatterLinkReference,
	LinkReference,
	CachedMetadataWithLinkReferences,
	TwoHopIndexedLink,
	BacklinksMap as DetailedBacklinksMap,
	IndexedFile,
	TwoHopLinkBranch,
	TwoHopLinkResult,
	ResolvePhase,
	ResolveProgress,
	LinkResolution,
	TaggedNote,
} from "./domain";

// サービスインターフェースをエクスポート
export type {
	IIndexingService,
	IPreviewService,
	IMetricProvider,
	SortMetricKind,
	ISortService,
} from "./services";

export type { DedupResult, DedupState } from "./deduplication";
