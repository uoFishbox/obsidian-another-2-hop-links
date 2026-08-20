import { z } from "zod";
import type { SortOption } from "core/sorting";
import { clonePluginSettings, DEFAULT_SETTINGS } from "./defaults";
import {
	DISPLAY_MODES,
	HIGHLIGHT_ON_OPEN_ACTIONS,
	LANGUAGES,
	MOBILE_LONG_PRESS_ACTIONS,
	SETTINGS_SCHEMA_VERSION,
	TWO_HOP_HEADER_SORT_ORDERS,
	type PluginSettings,
} from "./settings";

const SORT_OPTION_VALUES = [
	"alphabetical",
	"alphabetical-reverse",
	"created-date",
	"created-date-reverse",
	"modified-date",
	"modified-date-reverse",
	"backlink-count",
	"backlink-count-reverse",
	"file-size",
	"file-size-reverse",
] as const satisfies readonly SortOption[];

/** Compile error here means SORT_OPTION_VALUES is missing a SortOption member. */
export type AssertSortOptionsExhaustive =
	Exclude<SortOption, (typeof SORT_OPTION_VALUES)[number]> extends never
		? true
		: never;

/**
 * Keys removed from PluginSettings in past versions. They are dropped during
 * load so they never re-enter data.json after the next save.
 */
const OBSOLETE_SETTING_KEYS = [
	"twoHopListMode",
	"enableTwoRowMountedOverscan",
	"renderCodeBlockTypes",
] as const;

const positiveInteger = (fallback: number) =>
	z
		.number()
		.positive()
		.transform((value) => Math.floor(value))
		.catch(fallback);

const nonNegativeInteger = (fallback: number) =>
	z
		.number()
		.nonnegative()
		.transform((value) => Math.floor(value))
		.catch(fallback);

const positiveNumber = (fallback: number) => z.number().positive().catch(fallback);

const booleanSetting = (fallback: boolean) => z.boolean().catch(fallback);

const stringSetting = (fallback: string) => z.string().catch(fallback);

/**
 * Parses persisted settings. Every field falls back to its default on an
 * invalid value, so a corrupt data.json can never inject a wrong type into
 * the running plugin.
 */
export const PluginSettingsSchema = z.object({
	settingsSchemaVersion: z
		.literal(SETTINGS_SCHEMA_VERSION)
		.catch(SETTINGS_SCHEMA_VERSION),
	language: z.enum(LANGUAGES).catch(DEFAULT_SETTINGS.language),
	displayMode: z.enum(DISPLAY_MODES).catch(DEFAULT_SETTINGS.displayMode),
	useMergedLinksSection: booleanSetting(DEFAULT_SETTINGS.useMergedLinksSection),
	dedupeCards: booleanSetting(DEFAULT_SETTINGS.dedupeCards),
	enableTagFeatures: booleanSetting(DEFAULT_SETTINGS.enableTagFeatures ?? true),
	showTagsSection: booleanSetting(DEFAULT_SETTINGS.showTagsSection),
	defaultVisibleLinkCount: positiveInteger(DEFAULT_SETTINGS.defaultVisibleLinkCount),
	loadMoreLinkIncrement: positiveInteger(DEFAULT_SETTINGS.loadMoreLinkIncrement),
	cardWidthPx: positiveInteger(DEFAULT_SETTINGS.cardWidthPx),
	cardHeightRatio: positiveNumber(DEFAULT_SETTINGS.cardHeightRatio),
	cardGapPx: positiveInteger(DEFAULT_SETTINGS.cardGapPx),
	cardMaxColumns: positiveInteger(DEFAULT_SETTINGS.cardMaxColumns),
	sectionMarginBottomPx: positiveInteger(DEFAULT_SETTINGS.sectionMarginBottomPx),
	highlightOnOpen: z
		.enum(HIGHLIGHT_ON_OPEN_ACTIONS)
		.catch(DEFAULT_SETTINGS.highlightOnOpen),
	highlightInPreviewOnHover: booleanSetting(
		DEFAULT_SETTINGS.highlightInPreviewOnHover,
	),
	twoHopHeaderSortOrder: z
		.enum(TWO_HOP_HEADER_SORT_ORDERS)
		.catch(DEFAULT_SETTINGS.twoHopHeaderSortOrder),
	lastUsedSortOption: z
		.enum(SORT_OPTION_VALUES)
		.catch(DEFAULT_SETTINGS.lastUsedSortOption),
	previewMaxLines: nonNegativeInteger(DEFAULT_SETTINGS.previewMaxLines),
	previewMaxChars: nonNegativeInteger(DEFAULT_SETTINGS.previewMaxChars),
	previewVisualLineSafetyMargin: nonNegativeInteger(
		DEFAULT_SETTINGS.previewVisualLineSafetyMargin,
	),
	previewActivationAheadRows: nonNegativeInteger(
		DEFAULT_SETTINGS.previewActivationAheadRows,
	),
	previewDomCommitsPerSecond: positiveInteger(
		DEFAULT_SETTINGS.previewDomCommitsPerSecond,
	),
	searchPreviewSeekThresholdChars: nonNegativeInteger(
		DEFAULT_SETTINGS.searchPreviewSeekThresholdChars ?? 0,
	),
	searchPreviewSeekBufferChars: nonNegativeInteger(
		DEFAULT_SETTINGS.searchPreviewSeekBufferChars ?? 15,
	),
	showTwoHopForSelectedCanvasFileNode: booleanSetting(
		DEFAULT_SETTINGS.showTwoHopForSelectedCanvasFileNode,
	),
	mobileLongPressAction: z
		.enum(MOBILE_LONG_PRESS_ACTIONS)
		.catch(DEFAULT_SETTINGS.mobileLongPressAction),
	excludeAttachments: booleanSetting(DEFAULT_SETTINGS.excludeAttachments),
	frontmatterKeyCreatedDate: stringSetting(
		DEFAULT_SETTINGS.frontmatterKeyCreatedDate,
	),
	frontmatterKeyModifiedDate: stringSetting(
		DEFAULT_SETTINGS.frontmatterKeyModifiedDate,
	),
	enableGlobalSearchTagModal: booleanSetting(
		DEFAULT_SETTINGS.enableGlobalSearchTagModal,
	),
	enableUnresolvedLinkModal: booleanSetting(
		DEFAULT_SETTINGS.enableUnresolvedLinkModal,
	),
	enableEmptyViewAllNotesInNewTab: booleanSetting(
		DEFAULT_SETTINGS.enableEmptyViewAllNotesInNewTab,
	),
	pinBookmarkedToTopInAllNotes: booleanSetting(
		DEFAULT_SETTINGS.pinBookmarkedToTopInAllNotes,
	),
	enableLogging: booleanSetting(DEFAULT_SETTINGS.enableLogging),
	enableUnresolvedLinkDecoration: booleanSetting(
		DEFAULT_SETTINGS.enableUnresolvedLinkDecoration,
	),
	enableSearchArrowUpToEditorBottom: booleanSetting(
		DEFAULT_SETTINGS.enableSearchArrowUpToEditorBottom,
	),
	enableEditorArrowDownToSearchInput: booleanSetting(
		DEFAULT_SETTINGS.enableEditorArrowDownToSearchInput,
	),
	enableProgressiveTwoHopBuild: booleanSetting(
		DEFAULT_SETTINGS.enableProgressiveTwoHopBuild ?? true,
	),
	enableAdvancedCanvasIntegration: booleanSetting(
		DEFAULT_SETTINGS.enableAdvancedCanvasIntegration ?? false,
	),
	enableRipgrepContentSearch: booleanSetting(
		DEFAULT_SETTINGS.enableRipgrepContentSearch ?? false,
	),
	enableContentSearch: booleanSetting(DEFAULT_SETTINGS.enableContentSearch ?? false),
	ripgrepExecutablePath: stringSetting(DEFAULT_SETTINGS.ripgrepExecutablePath ?? ""),
	priorityFrontmatterKeyForPreview: stringSetting(
		DEFAULT_SETTINGS.priorityFrontmatterKeyForPreview ?? "",
	),
	priorityFrontmatterKeyForTitle: stringSetting(
		DEFAULT_SETTINGS.priorityFrontmatterKeyForTitle ?? "",
	),
	maxOutgoingToProcess: nonNegativeInteger(
		DEFAULT_SETTINGS.maxOutgoingToProcess ?? 0,
	),
});

type RawSettings = Record<string, unknown>;

/**
 * Migrates raw persisted settings toward SETTINGS_SCHEMA_VERSION.
 * Add versioned rename/reshape steps here before bumping the version.
 */
function migrateRawSettings(raw: RawSettings): RawSettings {
	const migrated = { ...raw };
	for (const key of OBSOLETE_SETTING_KEYS) {
		delete migrated[key];
	}
	return migrated;
}

/**
 * Validates unknown persisted data into PluginSettings, normalizing each
 * invalid field to its default. Non-object input falls back to full defaults.
 * The returned value never shares nested arrays with DEFAULT_SETTINGS.
 */
export function parsePluginSettings(raw: unknown): PluginSettings {
	if (typeof raw !== "object" || raw === null) {
		return clonePluginSettings(DEFAULT_SETTINGS);
	}

	const result = PluginSettingsSchema.safeParse(
		migrateRawSettings(raw as RawSettings),
	);
	if (!result.success) {
		return clonePluginSettings(DEFAULT_SETTINGS);
	}

	return clonePluginSettings(result.data);
}
