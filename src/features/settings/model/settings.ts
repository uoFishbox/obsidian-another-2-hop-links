export type SortOption =
	| "alphabetical"
	| "alphabetical-reverse"
	| "created-date"
	| "created-date-reverse"
	| "modified-date"
	| "modified-date-reverse"
	| "backlink-count"
	| "backlink-count-reverse"
	| "file-size"
	| "file-size-reverse";

export type DisplayMode = "editor-inline" | "sidebar-view" | "hybrid";

export type TwoHopHeaderSortOrder = "appearance" | "hop2-count-asc";

export type HighlightOnOpen = "always" | "never";

export type MobileLongPressAction = "preview" | "menu";

export type Language = "en" | "ja";

export const DEFAULT_CARD_WIDTH_PX = 140;
export const DEFAULT_CARD_HEIGHT_PX = 154;
export const DEFAULT_CARD_HEIGHT_RATIO = DEFAULT_CARD_HEIGHT_PX / DEFAULT_CARD_WIDTH_PX;
export const DEFAULT_CARD_GAP_PX = 12;
export const DEFAULT_CARD_MAX_COLUMNS = 6;
export const DEFAULT_SECTION_MARGIN_BOTTOM_PX = 45;

export const CARD_LAYOUT_SETTING_KEYS = [
	"cardWidthPx",
	"cardHeightRatio",
	"cardGapPx",
	"cardMaxColumns",
	"sectionMarginBottomPx",
] as const;

export type CardLayoutSettingKey = (typeof CARD_LAYOUT_SETTING_KEYS)[number];

export interface PluginSettings {
	language: Language;
	displayMode: DisplayMode;
	useMergedLinksSection: boolean;
	dedupeCards: boolean;
	enableTagFeatures?: boolean;
	showTagsSection: boolean;
	defaultVisibleLinkCount: number;
	loadMoreLinkIncrement: number;
	cardWidthPx: number;
	cardHeightRatio: number;
	cardGapPx: number;
	cardMaxColumns: number;
	sectionMarginBottomPx: number;
	highlightOnOpen: HighlightOnOpen;
	highlightInPreviewOnHover: boolean;
	twoHopHeaderSortOrder: TwoHopHeaderSortOrder;
	lastUsedSortOption: SortOption;
	previewMaxLines: number;
	previewMaxChars: number;
	previewVisualLineSafetyMargin: number;
	previewActivationAheadRows: number;
	enableTwoRowMountedOverscan: boolean;
	/** Maximum preview DOM updates committed per second while scrolling. */
	previewDomCommitsPerSecond: number;
	searchPreviewSeekThresholdChars?: number;
	searchPreviewSeekBufferChars?: number;
	showTwoHopForSelectedCanvasFileNode: boolean;
	renderCodeBlockTypes: string[];
	mobileLongPressAction: MobileLongPressAction;
	excludeAttachments: boolean;
	frontmatterKeyCreatedDate: string;
	frontmatterKeyModifiedDate: string;
	enableGlobalSearchTagModal: boolean;
	enableUnresolvedLinkModal: boolean;
	enableEmptyViewAllNotesInNewTab: boolean;
	pinBookmarkedToTopInAllNotes: boolean;
	enableLogging: boolean;
	enableUnresolvedLinkDecoration: boolean;
	enableSearchArrowUpToEditorBottom: boolean;
	enableEditorArrowDownToSearchInput: boolean;
	enableProgressiveTwoHopBuild?: boolean;
	enableAdvancedCanvasIntegration?: boolean;
	enableRipgrepContentSearch?: boolean;
	enableContentSearch?: boolean;
	ripgrepExecutablePath?: string;
	priorityFrontmatterKeyForPreview?: string;
	priorityFrontmatterKeyForTitle?: string;
	maxOutgoingToProcess?: number;
}

export function areTagFeaturesEnabled(
	settings: Pick<PluginSettings, "enableTagFeatures"> | undefined,
): boolean {
	return settings?.enableTagFeatures !== false;
}
