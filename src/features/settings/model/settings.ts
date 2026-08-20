import type { SortOption } from "core/sorting";
export {
	DEFAULT_CARD_GAP_PX,
	DEFAULT_CARD_HEIGHT_PX,
	DEFAULT_CARD_HEIGHT_RATIO,
	DEFAULT_CARD_MAX_COLUMNS,
	DEFAULT_CARD_WIDTH_PX,
	DEFAULT_SECTION_MARGIN_BOTTOM_PX,
} from "ui/layout/cardLayoutCssVars";

export const LANGUAGES = ["en", "ja"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DISPLAY_MODES = ["editor-inline", "sidebar-view", "hybrid"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const TWO_HOP_HEADER_SORT_ORDERS = ["appearance", "hop2-count-asc"] as const;
export type TwoHopHeaderSortOrder = (typeof TWO_HOP_HEADER_SORT_ORDERS)[number];

export const HIGHLIGHT_ON_OPEN_ACTIONS = ["always", "never"] as const;
export type HighlightOnOpen = (typeof HIGHLIGHT_ON_OPEN_ACTIONS)[number];

export const MOBILE_LONG_PRESS_ACTIONS = ["preview", "menu"] as const;
export type MobileLongPressAction = (typeof MOBILE_LONG_PRESS_ACTIONS)[number];

/** Current persisted settings shape version; bump when keys are renamed or reshaped. */
export const SETTINGS_SCHEMA_VERSION = 1;

export const CARD_LAYOUT_SETTING_KEYS = [
	"cardWidthPx",
	"cardHeightRatio",
	"cardGapPx",
	"cardMaxColumns",
	"sectionMarginBottomPx",
] as const;

export type CardLayoutSettingKey = (typeof CARD_LAYOUT_SETTING_KEYS)[number];

export interface PluginSettings {
	/** Always matches SETTINGS_SCHEMA_VERSION after a successful load. */
	settingsSchemaVersion: number;
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
	/** Maximum preview DOM updates committed per second while scrolling. */
	previewDomCommitsPerSecond: number;
	searchPreviewSeekThresholdChars?: number;
	searchPreviewSeekBufferChars?: number;
	showTwoHopForSelectedCanvasFileNode: boolean;
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
