import type { PluginSettings } from "features/settings/model";
import type { TranslationKey } from "../translations";

export type SectionId =
	| "language"
	| "display"
	| "preview"
	| "tags"
	| "canvas"
	| "interaction"
	| "emptyViewAllNotes"
	| "dateSortingSettings";

type SettingOption = {
	value: string;
	label: string;
	isTranslationKey?: false;
};

type TranslatedSettingOption = {
	value: string;
	label: TranslationKey;
	isTranslationKey: true;
};

export type SelectOption = SettingOption | TranslatedSettingOption;

interface BaseSettingDefinition<K extends keyof PluginSettings> {
	section: SectionId;
	settingKey: K;
	controlType: "toggle" | "dropdown" | "text" | "textarea";
	translationKey: TranslationKey;
	descriptionKey: TranslationKey;
	immediate?: boolean;
	desktopOnly?: boolean;
}

interface ToggleSettingDefinition<
	K extends keyof PluginSettings,
> extends BaseSettingDefinition<K> {
	controlType: "toggle";
}

interface DropdownSettingDefinition<
	K extends keyof PluginSettings,
> extends BaseSettingDefinition<K> {
	controlType: "dropdown";
	options: ReadonlyArray<SelectOption>;
}

interface TextSettingDefinition<
	K extends keyof PluginSettings,
> extends BaseSettingDefinition<K> {
	controlType: "text" | "textarea";
	placeholder?: string;
	parse: (value: string, settings: PluginSettings) => PluginSettings[K] | undefined;
	format?: (value: PluginSettings[K]) => string;
}

export type SettingDefinition<K extends keyof PluginSettings = keyof PluginSettings> =
	| ToggleSettingDefinition<K>
	| DropdownSettingDefinition<K>
	| TextSettingDefinition<K>;

export const SECTION_ORDER: ReadonlyArray<{
	id: SectionId;
	titleKey?: TranslationKey;
}> = [
	{ id: "language" },
	{ id: "display", titleKey: "display" },
	{ id: "tags", titleKey: "tags" },
	{ id: "canvas", titleKey: "canvas" },
	{ id: "preview", titleKey: "card" },
	{ id: "interaction", titleKey: "interaction" },
	{ id: "emptyViewAllNotes", titleKey: "emptyViewAllNotesSection" },
	{ id: "dateSortingSettings", titleKey: "dateSortingSettings" },
];

export const parsePositiveInteger = (value: string): number | undefined => {
	const num = Number.parseInt(value, 10);
	if (Number.isNaN(num) || num <= 0) {
		return undefined;
	}
	return num;
};

export const parseNonNegativeInteger = (value: string): number | undefined => {
	const num = Number.parseInt(value, 10);
	if (Number.isNaN(num) || num < 0) {
		return undefined;
	}
	return num;
};

export const parsePositiveNumber = (value: string): number | undefined => {
	const num = Number.parseFloat(value);
	if (!Number.isFinite(num) || num <= 0) {
		return undefined;
	}
	return num;
};

export const parseTrimmedString = (value: string): string => value.trim();

export const parseCommaSeparatedList = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
