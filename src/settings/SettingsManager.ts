import type { PluginHost } from "types/pluginHost";
import { z } from "zod";
import {
	CARD_LAYOUT_SETTING_KEYS,
	DEFAULT_SETTINGS,
	type DeskCardRecord,
	type DeskState,
	type PluginSettings,
} from "types/settings";

const SAVE_DEBOUNCE_DELAY_MS = 100;

interface UpdateOptions {
	immediate?: boolean;
}

type RawSettings = Record<string, unknown>;

const normalizePositiveIntegerSetting = (
	value: unknown,
	fallback: number,
): number => {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}

	return Math.floor(value);
};

const normalizePositiveNumberSetting = (
	value: unknown,
	fallback: number,
): number => {
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

const deskGridPositionSchema = z.object({
	column: z
		.number()
		.finite()
		.nonnegative()
		.transform((n) => Math.floor(n)),
	row: z
		.number()
		.finite()
		.nonnegative()
		.transform((n) => Math.floor(n)),
});

const deskCardRawSchema = z.object({
	path: z.string().min(1),
	addedAt: z.number().optional(),
	updatedAt: z.number().optional(),
	gridPosition: z.unknown().optional(),
});

const deskStateSchema = z.object({
	cards: z.array(z.unknown()).optional(),
});

export function normalizeDeskState(value: unknown): DeskState {
	const parsed = deskStateSchema.safeParse(value);
	if (!parsed.success) {
		return { version: 1, cards: [] };
	}

	const now = Date.now();
	const seen = new Set<string>();
	const normalizedCards: DeskCardRecord[] = [];

	for (const card of parsed.data.cards ?? []) {
		const cardResult = deskCardRawSchema.safeParse(card);
		if (!cardResult.success) {
			continue;
		}

		const { path, addedAt, updatedAt, gridPosition } = cardResult.data;
		if (seen.has(path)) {
			continue;
		}

		const gridPositionResult =
			deskGridPositionSchema.safeParse(gridPosition);
		const normalizedGridPosition = gridPositionResult.success
			? gridPositionResult.data
			: undefined;

		seen.add(path);
		normalizedCards.push({
			path,
			addedAt: addedAt ?? now,
			updatedAt: updatedAt ?? now,
			...(normalizedGridPosition ? { gridPosition: normalizedGridPosition } : {}),
		});
	}

	return {
		version: 1,
		cards: normalizedCards,
	};
}

function mergeSettings(raw: RawSettings): PluginSettings {
	const settings = Object.assign(createDefaultSettings(), raw);

	normalizeCardLayoutSettings(settings);

	settings.desk = normalizeDeskState(raw.desk);
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

	return settings as PluginSettings;
}

function normalizeCardLayoutSettings(settings: Record<string, unknown>): void {
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

export function cloneDeskState(state: DeskState): DeskState {
	return {
		version: 1,
		cards: state.cards.map((card) => ({
			...card,
			...(card.gridPosition
				? { gridPosition: { ...card.gridPosition } }
				: {}),
		})),
	};
}

function clonePluginSettings(settings: PluginSettings): PluginSettings {
	return {
		...settings,
		renderCodeBlockTypes: [...settings.renderCodeBlockTypes],
		desk: cloneDeskState(settings.desk),
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
