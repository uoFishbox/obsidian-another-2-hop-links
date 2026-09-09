import { z } from "zod";
import { SORT_OPTIONS } from "cards/sorting/types";
import { DEFAULT_SETTINGS } from "./defaults";
import {
	DISPLAY_MODES,
	LANGUAGES,
	MOBILE_LONG_PRESS_ACTIONS,
	SETTINGS_SCHEMA_VERSION,
	TWO_HOP_HEADER_SORT_ORDERS,
	type PluginSettings,
} from "./settings";

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
const PluginSettingsSchema = z.object({
	settingsSchemaVersion: z
		.literal(SETTINGS_SCHEMA_VERSION)
		.catch(SETTINGS_SCHEMA_VERSION),
	language: z.enum(LANGUAGES).catch(DEFAULT_SETTINGS.language),
	displayMode: z.enum(DISPLAY_MODES).catch(DEFAULT_SETTINGS.displayMode),
	useMergedLinksSection: booleanSetting(DEFAULT_SETTINGS.useMergedLinksSection),
	dedupeCards: booleanSetting(DEFAULT_SETTINGS.dedupeCards),
	enableTagFeatures: booleanSetting(DEFAULT_SETTINGS.enableTagFeatures),
	showTagsSection: booleanSetting(DEFAULT_SETTINGS.showTagsSection),
	defaultVisibleLinkCount: positiveInteger(DEFAULT_SETTINGS.defaultVisibleLinkCount),
	loadMoreLinkIncrement: positiveInteger(DEFAULT_SETTINGS.loadMoreLinkIncrement),
	cardWidthPx: positiveInteger(DEFAULT_SETTINGS.cardWidthPx),
	cardHeightRatio: positiveNumber(DEFAULT_SETTINGS.cardHeightRatio),
	cardGapPx: nonNegativeInteger(DEFAULT_SETTINGS.cardGapPx),
	cardMaxColumns: positiveInteger(DEFAULT_SETTINGS.cardMaxColumns),
	sectionMarginBottomPx: positiveInteger(DEFAULT_SETTINGS.sectionMarginBottomPx),
	highlightOnOpen: booleanSetting(DEFAULT_SETTINGS.highlightOnOpen),
	highlightInPreviewOnHover: booleanSetting(
		DEFAULT_SETTINGS.highlightInPreviewOnHover,
	),
	twoHopHeaderSortOrder: z
		.enum(TWO_HOP_HEADER_SORT_ORDERS)
		.catch(DEFAULT_SETTINGS.twoHopHeaderSortOrder),
	lastUsedSortOption: z.enum(SORT_OPTIONS).catch(DEFAULT_SETTINGS.lastUsedSortOption),
	previewMaxLines: nonNegativeInteger(DEFAULT_SETTINGS.previewMaxLines),
	previewMaxChars: nonNegativeInteger(DEFAULT_SETTINGS.previewMaxChars),
	previewVisualLineSafetyMargin: nonNegativeInteger(
		DEFAULT_SETTINGS.previewVisualLineSafetyMargin,
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
	enableUnresolvedLinkDecoration: booleanSetting(
		DEFAULT_SETTINGS.enableUnresolvedLinkDecoration,
	),
	enableSearchArrowUpToEditorBottom: booleanSetting(
		DEFAULT_SETTINGS.enableSearchArrowUpToEditorBottom,
	),
	enableEditorArrowDownToSearchInput: booleanSetting(
		DEFAULT_SETTINGS.enableEditorArrowDownToSearchInput,
	),
	enableContentSearch: booleanSetting(DEFAULT_SETTINGS.enableContentSearch),
	experimentalCosenseTitleEditing: booleanSetting(
		DEFAULT_SETTINGS.experimentalCosenseTitleEditing,
	),
	experimentalShadowDomCss: stringSetting(DEFAULT_SETTINGS.experimentalShadowDomCss),
	priorityFrontmatterKeyForPreview: stringSetting(
		DEFAULT_SETTINGS.priorityFrontmatterKeyForPreview,
	),
	priorityFrontmatterKeyForTitle: stringSetting(
		DEFAULT_SETTINGS.priorityFrontmatterKeyForTitle,
	),
});

/**
 * Validates unknown persisted data into PluginSettings, normalizing each
 * invalid field to its default. Non-object input falls back to full defaults.
 */
export function parsePluginSettings(raw: unknown): PluginSettings {
	if (typeof raw !== "object" || raw === null) {
		return { ...DEFAULT_SETTINGS };
	}

	const result = PluginSettingsSchema.safeParse(raw);
	if (!result.success) {
		return { ...DEFAULT_SETTINGS };
	}

	return result.data;
}
