import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import type { Language, PluginSettings } from "features/settings/model";
import {
	SECTION_ORDER,
	type SelectOption,
	type SettingDefinition,
} from "./sections/settingDefinition";
import { SETTING_DEFINITIONS } from "./sections";
import { t } from "./translations";

function getOptionLabel(option: SelectOption, lang: Language): string {
	if (option.isTranslationKey) {
		return t(option.label, lang);
	}
	return option.label;
}

function updatePluginSetting<K extends keyof PluginSettings>(
	plugin: PluginHost,
	key: K,
	value: PluginSettings[K],
	immediate?: boolean,
): Promise<void> {
	if (Object.is(plugin.settings[key], value)) {
		return Promise.resolve();
	}

	return plugin.updateSetting(key, value, immediate ? { immediate: true } : {});
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const lang = this.pluginInstance.settings.language;

		for (const section of SECTION_ORDER) {
			const sectionSettings = SETTING_DEFINITIONS.filter(
				(definition) =>
					definition.section === section.id &&
					(!definition.desktopOnly || Platform.isDesktopApp),
			);
			if (sectionSettings.length === 0) {
				continue;
			}

			if (section.titleKey) {
				containerEl.createEl("h2", { text: t(section.titleKey, lang) });
			}

			for (const definition of sectionSettings) {
				this.renderSetting(containerEl, definition, lang);
			}
		}
	}

	private renderSetting(
		containerEl: HTMLElement,
		definition: SettingDefinition,
		lang: Language,
	): void {
		const setting = new Setting(containerEl)
			.setName(t(definition.translationKey, lang))
			.setDesc(t(definition.descriptionKey, lang));
		const currentSettings = this.pluginInstance.settings;
		const currentValue = currentSettings[definition.settingKey];

		switch (definition.controlType) {
			case "toggle":
				setting.addToggle((toggle) =>
					toggle.setValue(Boolean(currentValue)).onChange((value) => {
						void updatePluginSetting(
							this.pluginInstance,
							definition.settingKey,
							value as PluginSettings[typeof definition.settingKey],
							definition.immediate,
						)
							.then(() => {
								if (definition.settingKey === "language") {
									this.display();
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
						void updatePluginSetting(
							this.pluginInstance,
							definition.settingKey,
							value as PluginSettings[typeof definition.settingKey],
							definition.immediate,
						)
							.then(() => {
								if (definition.settingKey === "language") {
									this.display();
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
							void updatePluginSetting(
								this.pluginInstance,
								definition.settingKey,
								parsed,
								definition.immediate,
							).catch(reportSettingUpdateError);
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
							void updatePluginSetting(
								this.pluginInstance,
								definition.settingKey,
								parsed,
								definition.immediate,
							).catch(reportSettingUpdateError);
						}),
				);
				return;
		}
	}
}
