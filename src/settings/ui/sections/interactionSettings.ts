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
		settingKey: "experimentalShadowDomCss",
		controlType: "textarea",
		translationKey: "experimentalShadowDomCss",
		descriptionKey: "experimentalShadowDomCssDesc",
		placeholder: ".cosense-card-links__box {\n\t/* Custom styles */\n}",
		rows: 10,
		parse: (value) => value,
	},
	{
		section: "interaction",
		settingKey: "highlightOnOpen",
		controlType: "toggle",
		translationKey: "highlightOnOpen",
		descriptionKey: "highlightOnOpenDesc",
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
