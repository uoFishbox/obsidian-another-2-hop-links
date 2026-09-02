import type { SettingDefinition } from "./settingDefinition";

export const INTERACTION_SETTING_DEFINITIONS: ReadonlyArray<SettingDefinition> = [
	{
		section: "interaction",
		settingKey: "experimentalCosenseTitleEditing",
		controlType: "toggle",
		translationKey: "experimentalCosenseTitleEditing",
		descriptionKey: "experimentalCosenseTitleEditingDesc",
	},
	{
		section: "interaction",
		settingKey: "highlightOnOpen",
		controlType: "dropdown",
		translationKey: "highlightOnOpen",
		descriptionKey: "highlightOnOpenDesc",
		options: [
			{ value: "always", label: "always", isTranslationKey: true },
			{ value: "never", label: "never", isTranslationKey: true },
		],
	},
	{
		section: "interaction",
		settingKey: "enableSearchArrowUpToEditorBottom",
		controlType: "toggle",
		translationKey: "enableSearchArrowUpToEditorBottom",
		descriptionKey: "enableSearchArrowUpToEditorBottomDesc",
	},
	{
		section: "interaction",
		settingKey: "enableEditorArrowDownToSearchInput",
		controlType: "toggle",
		translationKey: "enableEditorArrowDownToSearchInput",
		descriptionKey: "enableEditorArrowDownToSearchInputDesc",
	},
	{
		section: "interaction",
		settingKey: "highlightInPreviewOnHover",
		controlType: "toggle",
		translationKey: "highlightInPopoverOnHover",
		descriptionKey: "highlightInPopoverOnHoverDesc",
	},
	{
		section: "interaction",
		settingKey: "mobileLongPressAction",
		controlType: "dropdown",
		translationKey: "longPressActionMobile",
		descriptionKey: "longPressActionMobileDesc",
		options: [
			{ value: "preview", label: "showPreview", isTranslationKey: true },
			{ value: "menu", label: "showMenu", isTranslationKey: true },
		],
	},
	{
		section: "interaction",
		settingKey: "enableUnresolvedLinkModal",
		controlType: "toggle",
		translationKey: "openUnresolvedNoteView",
		descriptionKey: "openUnresolvedNoteViewDesc",
	},
];
