import { Platform, PluginSettingTab } from "obsidian";
import type {
	App,
	Setting,
	SettingDefinitionItem as ObsidianSettingDefinitionItem,
	SettingGroupItem,
} from "obsidian";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { Language, PluginSettings } from "settings/model";
import {
	SECTION_ORDER,
	type SelectOption,
	type SettingDefinition,
} from "./sections/settingDefinition";
import { DISPLAY_SETTING_DEFINITIONS } from "./sections/displaySettings";
import { INTERACTION_SETTING_DEFINITIONS } from "./sections/interactionSettings";
import { PREVIEW_SETTING_DEFINITIONS } from "./sections/previewSettings";
import { t } from "./translations";

const SETTING_DEFINITIONS: ReadonlyArray<SettingDefinition> = [
	...DISPLAY_SETTING_DEFINITIONS,
	...PREVIEW_SETTING_DEFINITIONS,
	...INTERACTION_SETTING_DEFINITIONS,
];

function getOptionLabel(option: SelectOption, lang: Language): string {
	if (option.isTranslationKey) {
		return t(option.label, lang);
	}
	return option.label;
}

function reportSettingUpdateError(error: unknown): void {
	console.error("設定の更新に失敗しました:", error);
}

export class CosenseCardLinksSettingTab extends PluginSettingTab {
	private readonly pluginInstance: PluginHost;

	constructor(app: App, plugin: PluginHost) {
		super(app, plugin);
		this.pluginInstance = plugin;
	}

	getSettingDefinitions(): ObsidianSettingDefinitionItem[] {
		const lang = this.pluginInstance.settings.language;
		const items: ObsidianSettingDefinitionItem[] = [];

		for (const section of SECTION_ORDER) {
			const sectionSettings = SETTING_DEFINITIONS.filter(
				(definition) =>
					definition.section === section.id &&
					(!definition.desktopOnly || Platform.isDesktopApp),
			);
			if (sectionSettings.length === 0) {
				continue;
			}

			const settingItems = sectionSettings.map(
				(definition): SettingGroupItem => ({
					name: t(definition.translationKey, lang),
					desc: t(definition.descriptionKey, lang),
					render: (setting) => this.renderControl(setting, definition, lang),
				}),
			);

			if (!section.titleKey) {
				items.push(...settingItems);
				continue;
			}

			items.push({
				type: "group",
				heading: t(section.titleKey, lang),
				items: settingItems,
			});
		}

		return items;
	}

	private renderControl(
		setting: Setting,
		definition: SettingDefinition,
		lang: Language,
	): void {
		const currentSettings = this.pluginInstance.settings;
		const currentValue = currentSettings[definition.settingKey];

		switch (definition.controlType) {
			case "toggle":
				setting.addToggle((toggle) =>
					toggle.setValue(Boolean(currentValue)).onChange((value) => {
						void this.pluginInstance
							.updateSetting(
								definition.settingKey,
								value as PluginSettings[typeof definition.settingKey],
								definition.immediate ? { immediate: true } : undefined,
							)
							.then(() => {
								if (definition.settingKey === "language") {
									this.update();
								}
							})
							.catch(reportSettingUpdateError);
					}),
				);
				return;
			case "dropdown":
				setting.addDropdown((dropdown) => {
					for (const option of definition.options) {
						dropdown.addOption(option.value, getOptionLabel(option, lang));
					}
					dropdown.setValue(String(currentValue)).onChange((value) => {
						void this.pluginInstance
							.updateSetting(
								definition.settingKey,
								value as PluginSettings[typeof definition.settingKey],
								definition.immediate ? { immediate: true } : undefined,
							)
							.then(() => {
								if (definition.settingKey === "language") {
									this.update();
								}
							})
							.catch(reportSettingUpdateError);
					});
				});
				return;
			case "text":
				setting.addText((text) =>
					text
						.setPlaceholder(definition.placeholder ?? "")
						.setValue(
							definition.format
								? definition.format(
										currentValue as PluginSettings[typeof definition.settingKey],
									)
								: String(currentValue ?? ""),
						)
						.onChange((value) => {
							const parsed = definition.parse(value, currentSettings);
							if (parsed === undefined) {
								return;
							}
							void this.pluginInstance
								.updateSetting(
									definition.settingKey,
									parsed,
									definition.immediate
										? { immediate: true }
										: undefined,
								)
								.catch(reportSettingUpdateError);
						}),
				);
				return;
			case "textarea":
				setting.addTextArea((text) =>
					text
						.setPlaceholder(definition.placeholder ?? "")
						.setValue(
							definition.format
								? definition.format(
										currentValue as PluginSettings[typeof definition.settingKey],
									)
								: String(currentValue ?? ""),
						)
						.onChange((value) => {
							const parsed = definition.parse(value, currentSettings);
							if (parsed === undefined) {
								return;
							}
							void this.pluginInstance
								.updateSetting(
									definition.settingKey,
									parsed,
									definition.immediate
										? { immediate: true }
										: undefined,
								)
								.catch(reportSettingUpdateError);
						}),
				);
				return;
		}
	}
}
