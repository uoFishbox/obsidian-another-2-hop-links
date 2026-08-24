import {
	DEFAULT_CARD_GAP_PX,
	DEFAULT_CARD_HEIGHT_RATIO,
	DEFAULT_CARD_MAX_COLUMNS,
	DEFAULT_CARD_WIDTH_PX,
	DEFAULT_SECTION_MARGIN_BOTTOM_PX,
	SETTINGS_SCHEMA_VERSION,
	type PluginSettings,
} from "./settings";

export const DEFAULT_SETTINGS: PluginSettings = {
	settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
	language: "en",
	displayMode: "editor-inline",
	useMergedLinksSection: false,
	dedupeCards: true,
	enableTagFeatures: true,
	showTagsSection: true,
	defaultVisibleLinkCount: 15,
	loadMoreLinkIncrement: 15,
	cardWidthPx: DEFAULT_CARD_WIDTH_PX,
	cardHeightRatio: DEFAULT_CARD_HEIGHT_RATIO,
	cardGapPx: DEFAULT_CARD_GAP_PX,
	cardMaxColumns: DEFAULT_CARD_MAX_COLUMNS,
	sectionMarginBottomPx: DEFAULT_SECTION_MARGIN_BOTTOM_PX,
	highlightOnOpen: "always",
	highlightInPreviewOnHover: true,
	twoHopHeaderSortOrder: "appearance",
	lastUsedSortOption: "alphabetical",
	previewMaxLines: 15,
	previewMaxChars: 500,
	previewVisualLineSafetyMargin: 0,
	showTwoHopForSelectedCanvasFileNode: true,
	mobileLongPressAction: "preview",
	excludeAttachments: false,
	frontmatterKeyCreatedDate: "",
	frontmatterKeyModifiedDate: "",
	enableGlobalSearchTagModal: true,
	enableUnresolvedLinkModal: true,
	enableEmptyViewAllNotesInNewTab: true,
	pinBookmarkedToTopInAllNotes: true,
	enableUnresolvedLinkDecoration: true,
	enableSearchArrowUpToEditorBottom: true,
	enableEditorArrowDownToSearchInput: true,
	priorityFrontmatterKeyForPreview: "",
	priorityFrontmatterKeyForTitle: "",
	enableContentSearch: false,
};

/** Returns an independent settings object. */
export function clonePluginSettings(settings: PluginSettings): PluginSettings {
	return { ...settings };
}
