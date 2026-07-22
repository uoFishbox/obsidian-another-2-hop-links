import type { PluginHost } from "types/pluginHost";
import {
	CARD_LAYOUT_SETTING_KEYS,
	DEFAULT_SETTINGS,
	type PluginSettings,
} from "features/settings/model";

const SAVE_DEBOUNCE_DELAY_MS = 100;

interface UpdateOptions {
	immediate?: boolean;
}

type RawSettings = Record<string, unknown>;

const normalizePositiveIntegerSetting = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}

	return Math.floor(value);
};

const normalizePositiveNumberSetting = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}

	return value;
};

const normalizeNonNegativeIntegerSetting = (
	value: unknown,
	fallback: number,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return fallback;
	}

	return Math.floor(value);
};

function mergeSettings(raw: RawSettings): PluginSettings {
	const settings = createDefaultSettings();
	for (const key of Object.keys(settings) as Array<keyof PluginSettings>) {
		if (key in raw) {
			Object.assign(settings, { [key]: raw[key] });
		}
	}

	normalizeCardLayoutSettings(settings);

	settings.previewMaxChars = normalizeNonNegativeIntegerSetting(
		settings.previewMaxChars,
		DEFAULT_SETTINGS.previewMaxChars,
	);
	settings.previewMaxLines = normalizeNonNegativeIntegerSetting(
		settings.previewMaxLines,
		DEFAULT_SETTINGS.previewMaxLines,
	);
	settings.previewVisualLineSafetyMargin = normalizeNonNegativeIntegerSetting(
		settings.previewVisualLineSafetyMargin,
		DEFAULT_SETTINGS.previewVisualLineSafetyMargin,
	);
	settings.previewActivationAheadRows = normalizeNonNegativeIntegerSetting(
		settings.previewActivationAheadRows,
		DEFAULT_SETTINGS.previewActivationAheadRows,
	);
	settings.previewDomCommitsPerSecond = normalizePositiveIntegerSetting(
		settings.previewDomCommitsPerSecond,
		DEFAULT_SETTINGS.previewDomCommitsPerSecond,
	);

	return settings as PluginSettings;
}

function normalizeCardLayoutSettings(settings: PluginSettings): void {
	for (const key of CARD_LAYOUT_SETTING_KEYS) {
		if (key === "cardHeightRatio") {
			settings[key] = normalizePositiveNumberSetting(
				settings[key],
				DEFAULT_SETTINGS[key],
			);
			continue;
		}

		settings[key] = normalizePositiveIntegerSetting(
			settings[key],
			DEFAULT_SETTINGS[key],
		);
	}
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
			const raw = (data ?? {}) as RawSettings;
			this.plugin.settings = mergeSettings(raw);
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

function clonePluginSettings(settings: PluginSettings): PluginSettings {
	return {
		...settings,
		renderCodeBlockTypes: [...settings.renderCodeBlockTypes],
	};
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
