import type { MarkdownView, Plugin, TFile } from "obsidian";
import type { PluginSettings } from "settings/model";
import type { ResolveProgress, TwoHopLinkResult } from "two-hop/model";
import type { ResolveOptions } from "two-hop/resolution/TwoHopLinkResolver";
import type { IIndexingService } from "indexing/index-service/IndexingService";
import type { ISortService } from "cards/sorting";

export interface PluginSettingsManager {
	readonly settings: PluginSettings;
	update<K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
		options?: { immediate?: boolean },
	): Promise<void>;
	updateBatch(
		updates: Partial<PluginSettings>,
		options?: { immediate?: boolean },
	): Promise<void>;
}

/**
 * IndexUpdateQueue のうち、PluginHost 経由で外部から参照されるメンバー。
 */
export interface PluginIndexUpdateQueue {
	requestIndexUpdateForFile(path: string): void;
}

/**
 * ComponentController のうち、PluginHost 経由で外部から参照されるメンバー。
 */
export interface PluginComponentController {
	mountComponentsForView(
		view: MarkdownView,
		file: TFile | undefined,
		options?: { skipIfMounted?: boolean },
	): void;
	unmountViewComponents(view: MarkdownView): void;
}

/**
 * プラグインの外部公開サーフェス。
 *
 * 実装は `main.ts` の `CosenseCardLinksPlugin` クラス。
 * 各モジュールはクラス実装ではなくこの型を参照することで、
 * `main.ts` への型 import に起因する循環依存を断つ。
 *
 * `Plugin` 由来のメソッド（`register`, `registerEvent`, `addCommand`,
 * `registerView`, `registerMarkdownPostProcessor`, `registerEditorExtension`,
 * `registerHoverLinkSource`, `loadData`, `saveData` など）は
 * `extends Plugin` により再定義不要。
 *
 * 公開する collaborator はすべて構造的インターフェースで型付けする。
 * UI 固有の生成・共有 capability はこの host に含めず、UI composition root
 * から `ViewServices` として別に注入する。
 */
export interface PluginHost extends Plugin {
	settings: PluginSettings;
	settingsManager: PluginSettingsManager;
	indexingService: IIndexingService;
	sortService: ISortService;
	indexUpdateQueue: PluginIndexUpdateQueue;
	componentController: PluginComponentController;

	getTwoHopLinkResult(
		file: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopLinkResult>;
	updateSetting<K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
		options?: { immediate?: boolean },
	): Promise<void>;
	updateSettings(
		updates: Partial<PluginSettings>,
		options?: { immediate?: boolean },
	): Promise<void>;
}
