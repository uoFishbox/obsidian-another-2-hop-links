import type { MarkdownView, Plugin, TFile } from "obsidian";
import type { StateEffectType } from "@codemirror/state";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { SortService } from "core/sorting/SortService";
import type { DisplayDataBuilder } from "application/presenters/displayDataBuilder";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type {
	DeskGridPosition,
	DeskState,
	PluginSettings,
} from "types/settings";
import type { ResolveProgress, TwoHopLinkResult } from "types/domain";
import type { ResolveOptions } from "core/indexing/two-hop-resolver/TwoHopLinkResolver";
import type { ResolveTwoHopLinks } from "ui/stores/application/TwoHopLinksLoader";

/**
 * SettingsManager のうち、PluginHost 経由で外部から参照されるメンバー。
 *
 * 具象クラスを import すると `SettingsManager` ↔ `PluginHost` の型循環が
 * 再発するため、構造的インターフェースで参照する。
 * `SettingsManager` はこの形状を構造的に満たす。
 */
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
	getSnapshot(): PluginSettings;
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
 * DeskStore のうち、PluginHost 経由で外部から参照されるメンバー。
 */
export interface PluginDeskStore {
	getSnapshot(): DeskState;
	subscribe(listener: (state: DeskState) => void): () => void;
	placePath(path: string, gridPosition: DeskGridPosition): Promise<void>;
	placePathAndMoveOccupant(
		path: string,
		gridPosition: DeskGridPosition,
		occupantPath: string,
		occupantGridPosition: DeskGridPosition,
	): Promise<void>;
	removePath(path: string): Promise<void>;
	clear(): Promise<void>;
	handleRename(oldPath: string, newPath: string): Promise<void>;
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
 * なお `settingsManager`, `indexUpdateQueue`, `componentController`,
 * `deskStore` は具象クラスではなく構造的インターフェースで型付けしている。
 * これらの具象クラスは本インターフェースを import するため、
 * 逆方向の import（本ファイル → 各クラス）を行うと型のみの循環が再発する。
 */
export interface PluginHost extends Plugin {
	settings: PluginSettings;
	settingsManager: PluginSettingsManager;
	deskStore: PluginDeskStore;
	indexingService: IndexingService;
	sortService: SortService;
	indexUpdateQueue: PluginIndexUpdateQueue;
	componentController: PluginComponentController;
	readonly forceRedrawEffect: StateEffectType<undefined>;

	createDisplayDataBuilder(): DisplayDataBuilder;
	getSortContextVersion(): number;
	getTwoHopLinkResult(
		file: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopLinkResult>;
	getLinkContextFactory(): (
		file: TFile,
		settings: PluginSettings,
	) => LinkContext;
	createApplicationStore(
		settings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore;
	getOrCreateApplicationStore(
		leafId: string,
		filePath: string,
		settings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore;
	clearStore(leafId: string, filePath: string): void;
	processUnresolvedLinksInElement(el: HTMLElement, sourcePath: string): void;
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
