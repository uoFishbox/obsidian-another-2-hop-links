import type { PluginHost } from "types/pluginHost";
import {
	clonePluginSettings,
	DEFAULT_SETTINGS,
	parsePluginSettings,
	type PluginSettings,
} from "features/settings/model";

const SAVE_DEBOUNCE_DELAY_MS = 100;

interface UpdateOptions {
	immediate?: boolean;
}

export class SettingsManager {
	private snapshot: PluginSettings;
	private saveDebounceTimer: number | undefined = undefined;

	constructor(private plugin: PluginHost) {
		if (!this.plugin.settings) {
			this.plugin.settings = createDefaultSettings();
		}
		this.snapshot = this.createSnapshot();
	}

	public get settings(): PluginSettings {
		return this.plugin.settings;
	}

	async load(): Promise<void> {
		try {
			const data = await this.plugin.loadData();
			this.plugin.settings = parsePluginSettings(data);
			this.snapshot = this.createSnapshot();
		} catch (error) {
			console.error("設定の読み込みに失敗しました:", error);
			this.plugin.settings = createDefaultSettings();
			this.snapshot = this.createSnapshot();
			throw error;
		}
	}

	async saveImmediate(): Promise<void> {
		this.cancelScheduledSave();
		await this.persistSettings();
	}

	private scheduleSave(): void {
		this.cancelScheduledSave();

		this.saveDebounceTimer = window.setTimeout(async () => {
			this.saveDebounceTimer = undefined;
			try {
				await this.persistSettings();
			} catch {
				// Debounced persistence has no caller to receive the rejection.
			}
		}, SAVE_DEBOUNCE_DELAY_MS);
	}

	private cancelScheduledSave(): void {
		if (this.saveDebounceTimer === undefined) {
			return;
		}

		window.clearTimeout(this.saveDebounceTimer);
		this.saveDebounceTimer = undefined;
	}

	private async persistSettings(): Promise<void> {
		try {
			await this.plugin.saveData(this.settings);
		} catch (error) {
			console.error("設定の保存に失敗しました:", error);
			throw error;
		}
	}

	private async save(options: UpdateOptions): Promise<void> {
		if (options.immediate) {
			await this.saveImmediate();
			return;
		}

		this.scheduleSave();
	}

	async update<K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
		options: UpdateOptions = {},
	): Promise<void> {
		this.settings[key] = value;
		this.snapshot = this.createSnapshot();
		await this.save(options);
	}

	async updateBatch(
		updates: Partial<PluginSettings>,
		options: UpdateOptions = {},
	): Promise<void> {
		Object.assign(this.settings, updates);
		this.snapshot = this.createSnapshot();
		await this.save(options);
	}

	getSnapshot(): PluginSettings {
		return this.snapshot;
	}

	private createSnapshot(): PluginSettings {
		return deepFreeze(clonePluginSettings(this.settings));
	}

	async destroy(): Promise<void> {
		if (this.saveDebounceTimer !== undefined) {
			await this.saveImmediate();
		}
	}
}

function createDefaultSettings(): PluginSettings {
	return clonePluginSettings(DEFAULT_SETTINGS);
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null) {
		return value;
	}

	Object.freeze(value);

	for (const nestedValue of Object.values(value)) {
		if (
			typeof nestedValue === "object" &&
			nestedValue !== null &&
			!Object.isFrozen(nestedValue)
		) {
			deepFreeze(nestedValue);
		}
	}

	return value;
}
