import { ADVANCED_SETTING_DEFINITIONS } from "./advancedSettings";
import { DISPLAY_SETTING_DEFINITIONS } from "./displaySettings";
import { INTERACTION_SETTING_DEFINITIONS } from "./interactionSettings";
import { PREVIEW_SETTING_DEFINITIONS } from "./previewSettings";
import type { SettingDefinition } from "./settingDefinition";

export const SETTING_DEFINITIONS: ReadonlyArray<SettingDefinition> = [
	...DISPLAY_SETTING_DEFINITIONS,
	...PREVIEW_SETTING_DEFINITIONS,
	...INTERACTION_SETTING_DEFINITIONS,
	...ADVANCED_SETTING_DEFINITIONS,
];
