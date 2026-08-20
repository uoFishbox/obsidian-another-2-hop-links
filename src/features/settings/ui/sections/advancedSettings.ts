import { parseTrimmedString } from "./settingDefinition";
import type { SettingDefinition } from "./settingDefinition";

export const ADVANCED_SETTING_DEFINITIONS: ReadonlyArray<SettingDefinition> = [
	{
		section: "integrationAdvancedSettings",
		settingKey: "enableLogging",
		controlType: "toggle",
		translationKey: "enableLogging",
		descriptionKey: "enableLoggingDesc",
	},
	{
		section: "experimental",
		settingKey: "enableAdvancedCanvasIntegration",
		controlType: "toggle",
		translationKey: "enableAdvancedCanvasIntegration",
		descriptionKey: "enableAdvancedCanvasIntegrationDesc",
	},
	{
		section: "experimental",
		settingKey: "enableRipgrepContentSearch",
		controlType: "toggle",
		translationKey: "enableRipgrepContentSearch",
		descriptionKey: "enableRipgrepContentSearchDesc",
		desktopOnly: true,
	},
	{
		section: "experimental",
		settingKey: "ripgrepExecutablePath",
		controlType: "text",
		translationKey: "ripgrepExecutablePath",
		descriptionKey: "ripgrepExecutablePathDesc",
		placeholder: "rg",
		parse: (value) => parseTrimmedString(value),
		format: (value) => (typeof value === "string" ? value : ""),
		desktopOnly: true,
	},
];
