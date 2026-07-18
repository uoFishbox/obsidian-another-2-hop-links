import type { TFile } from "obsidian";
import {
	CARD_LAYOUT_SETTING_KEYS,
	type PluginSettings,
	type SortOption,
} from "types/settings";
import type { ResolveProgress, TwoHopLinkResult } from "types";
import type { TaggedNote, TwoHopIndexedLink } from "types/domain";
import type {
	DisplayData,
	DisplayDataBuilder,
} from "application/presenters/displayDataBuilder";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import {
	computePreprocessedDisplayDataState,
	computeSortedDisplayDataState,
	createPreprocessedDisplayDataCache,
	type ComputedDisplayData,
	type ComputedPreprocessedDisplayData,
	type PreprocessedDisplayDataCache,
} from "ui/stores/application/DisplayStateCalculator";
import {
	decideDataUpdateAction,
	type PreviewInvalidation,
} from "ui/stores/application/dataUpdateReloadDecider";
import {
	type ResolveTwoHopLinks,
	TwoHopLinksLoader,
} from "ui/stores/application/TwoHopLinksLoader";
import {
	clearSectionExpandedLimit,
	getDefaultSectionVisibleLimit,
	getSectionExpandedLimit,
	resolveSortOption,
	setSectionExpandedLimit,
	type SectionExpansionLimits,
} from "ui/stores/application/viewUiStateManager";

export type { DisplayDataBuilder } from "application/presenters/displayDataBuilder";

export type LoadingPhase =
	| "idle"
	| "initial"
	| "base-ready"
	| "twohop-ready"
	| "complete";

export type LoadedPhase = Exclude<LoadingPhase, "idle" | "initial">;

export interface ViewUiState {
	sectionExpandedLimits: SectionExpansionLimits;
	sortOption: SortOption;
}

export interface LoadedApplicationData {
	phase: LoadedPhase;
	data: TwoHopLinkResult;
	displaySourceData: TwoHopLinkResult;
}

export type ApplicationLoadState =
	| { type: "idle" }
	| { type: "loading"; phase: "initial" }
	| ({ type: "loaded" } & LoadedApplicationData)
	| { type: "error"; error: Error; previousData?: LoadedApplicationData };

export interface ApplicationSnapshot {
	loadState: ApplicationLoadState;
	loading: boolean;
	loadingPhase: LoadingPhase;
	error: Error | undefined;
	data: TwoHopLinkResult | undefined;
	displayData: DisplayData;
	sortOption: SortOption;
	sectionExpandedLimits: SectionExpansionLimits;
	hasDisplayableItems: boolean;
	initialVisibleCount: number;
	loadMoreIncrement: number;
	settings: PluginSettings;
}

interface ActiveApplicationLoad {
	filePath: string;
	promise: Promise<void>;
}

const DISPLAY_REFRESH_EXCLUDED_SETTINGS = new Set<keyof PluginSettings>([
	"lastUsedSortOption",
	...CARD_LAYOUT_SETTING_KEYS,
]);

function getChangedSettingKeys(
	previous: PluginSettings,
	next: PluginSettings,
): Array<keyof PluginSettings> {
	return (Object.keys(next) as Array<keyof PluginSettings>).filter(
		(key) => previous[key] !== next[key],
	);
}

function shouldRefreshDisplayData(changedKeys: Array<keyof PluginSettings>): boolean {
	return changedKeys.some((key) => !DISPLAY_REFRESH_EXCLUDED_SETTINGS.has(key));
}

function areArraysEqualByRef<T>(
	previous: T[] | undefined,
	next: T[] | undefined,
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next || previous.length !== next.length) {
		return false;
	}
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}
	return true;
}

function resolveNextDisplaySource(
	previousDisplaySource: TwoHopLinkResult | undefined,
	nextData: TwoHopLinkResult,
	loadingPhase: LoadedPhase,
	settings: PluginSettings,
): TwoHopLinkResult | undefined {
	if (loadingPhase === "base-ready" || loadingPhase === "twohop-ready") {
		return nextData;
	}

	if (!previousDisplaySource) {
		return nextData;
	}

	const previousDisplayVersions = previousDisplaySource.displayVersions;
	const nextDisplayVersions = nextData.displayVersions;
	if (previousDisplayVersions && nextDisplayVersions) {
		const sameLinks = previousDisplayVersions.links === nextDisplayVersions.links;
		if (!sameLinks) {
			return nextData;
		}
		if (!settings.showTagsSection) {
			return undefined;
		}
		if (previousDisplayVersions.tags === nextDisplayVersions.tags) {
			return undefined;
		}
		return {
			...nextData,
			branches: previousDisplaySource.branches,
			backlinks: previousDisplaySource.backlinks,
		};
	}

	const sameBranches = areArraysEqualByRef(
		previousDisplaySource.branches,
		nextData.branches,
	);
	const sameBacklinks = areArraysEqualByRef(
		previousDisplaySource.backlinks,
		nextData.backlinks,
	);

	if (!settings.showTagsSection) {
		return sameBranches && sameBacklinks ? undefined : nextData;
	}

	const sameTaggedNotes = areArraysEqualByRef(
		previousDisplaySource.taggedNotes,
		nextData.taggedNotes,
	);

	if (!sameBranches || !sameBacklinks) {
		return nextData;
	}

	if (sameTaggedNotes) {
		return undefined;
	}

	return {
		...nextData,
		branches: previousDisplaySource.branches,
		backlinks: previousDisplaySource.backlinks,
	};
}

function getLoadedApplicationData(
	state: ApplicationLoadState,
): LoadedApplicationData | undefined {
	if (state.type === "loaded") {
		return state;
	}
	if (state.type === "error") {
		return state.previousData;
	}
	return undefined;
}

function getLoadingPhase(state: ApplicationLoadState): LoadingPhase {
	if (state.type === "idle") {
		return "idle";
	}
	if (state.type === "loading") {
		return state.phase;
	}
	if (state.type === "error") {
		return state.previousData?.phase ?? "idle";
	}
	return state.phase;
}

function getLoadError(state: ApplicationLoadState): Error | undefined {
	return state.type === "error" ? state.error : undefined;
}

/**
 * 単一のアプリケーションストア（Svelte 5 Runes 実装）
 * - リンクデータの読み込みと状態管理
 * - UI状態（表示数、ソートオプション）の管理
 * - 派生状態の自動計算
 */
export class ApplicationStore {
	declare readonly loadState: ApplicationLoadState;
	declare readonly loading: boolean;
	declare readonly loadingPhase: LoadingPhase;
	declare readonly data: TwoHopLinkResult | undefined;
	declare readonly displaySourceData: TwoHopLinkResult | undefined;
	declare readonly error: Error | undefined;
	declare sortOption: SortOption;
	declare settings: PluginSettings;
	declare sectionExpandedLimits: SectionExpansionLimits;
	declare updateVersion: number;
	declare previewGlobalVersion: number;
	declare previewPathVersions: Record<string, number>;
	declare displayState: ComputedDisplayData;
	declare displayData: DisplayData;
	declare hasDisplayableItems: boolean;
	declare initialVisibleCount: number;
	declare loadMoreIncrement: number;

	declare private preprocessedDisplayData: ComputedPreprocessedDisplayData;
	declare private computedDisplayData: ComputedDisplayData;
	declare private displayDataBuilder: DisplayDataBuilder;
	declare private mutableLoadState: ApplicationLoadState;
	private readonly preprocessedDisplayDataCache: PreprocessedDisplayDataCache;
	private readonly loader: TwoHopLinksLoader;
	private unsubscribeDataUpdate: (() => void) | undefined = undefined;
	private activeLoad: ActiveApplicationLoad | undefined;

	constructor(
		initialSettings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
		private readonly onSortChange: (newSortOption: SortOption) => void,
		private readonly onUpdateContentSearch: (enabled: boolean) => void = () => {},
	) {
		this.displayDataBuilder = displayDataBuilder;
		this.loader = new TwoHopLinksLoader(resolveTwoHopLinks);
		this.preprocessedDisplayDataCache = createPreprocessedDisplayDataCache();

		// 大きなオブジェクトは深いプロキシを避け、union 全体の再代入だけで更新する
		this.mutableLoadState = $state.raw<ApplicationLoadState>({
			type: "loading",
			phase: "initial",
		});
		this.loadState = $derived(this.mutableLoadState);
		this.loading = $derived(this.loadState.type === "loading");
		this.loadingPhase = $derived(getLoadingPhase(this.loadState));
		this.data = $derived(getLoadedApplicationData(this.loadState)?.data);
		this.displaySourceData = $derived(
			getLoadedApplicationData(this.loadState)?.displaySourceData,
		);
		this.error = $derived(getLoadError(this.loadState));
		this.sortOption = $state<SortOption>(initialSettings.lastUsedSortOption);
		this.settings = $state.raw<PluginSettings>(initialSettings);
		this.sectionExpandedLimits = $state.raw<SectionExpansionLimits>({});
		this.updateVersion = $state(0);
		this.previewGlobalVersion = $state(0);
		this.previewPathVersions = $state.raw<Record<string, number>>({});

		// data/settings 依存の前処理を先に計算し、sortOption 変更時は再利用する
		this.preprocessedDisplayData = $derived.by(
			(): ComputedPreprocessedDisplayData =>
				computePreprocessedDisplayDataState(
					this.displayDataBuilder,
					this.displaySourceData,
					this.settings,
					this.preprocessedDisplayDataCache,
				),
		);

		// ソート段のみを sortOption 依存で再計算する
		this.computedDisplayData = $derived.by(
			(): ComputedDisplayData =>
				computeSortedDisplayDataState(
					this.displayDataBuilder,
					this.preprocessedDisplayData,
					this.settings,
					this.sortOption,
				),
		);
		this.displayState = $derived(this.computedDisplayData);
		this.displayData = $derived(this.displayState.displayData);
		this.hasDisplayableItems = $derived(this.displayState.hasDisplayableItems);
		this.initialVisibleCount = $derived(this.settings.defaultVisibleLinkCount);
		this.loadMoreIncrement = $derived(this.settings.loadMoreLinkIncrement);
	}

	triggerUpdate(): void {
		this.updateVersion += 1;
	}

	getPreviewRenderVersion(path: string): string {
		return `${this.previewGlobalVersion}:${this.previewPathVersions[path] ?? 0}`;
	}

	/**
	 * IndexingService のデータ更新イベントを購読
	 * データが更新されたら現在のファイルを再読み込み
	 */
	subscribeToDataUpdates(unsubscribe: () => void): void {
		this.unsubscribeDataUpdate = unsubscribe;
	}

	/**
	 * データ更新イベントハンドラ。
	 *
	 * current file に紐づく通常ページでは、関連する index 更新だけを reload する。
	 * EmptyViewAllNotes のような current file を持たない global list では、
	 * display data reload ではなく updateVersion だけを進める。
	 */
	async handleDataUpdate(context?: DataUpdateContext): Promise<void> {
		const currentFile = this.loader.getCurrentFile();
		if (!currentFile) {
			this.triggerUpdate();
			return;
		}

		const reloadDecisionInput = {
			currentFile,
			data: this.data,
			context,
		};

		const action = decideDataUpdateAction(reloadDecisionInput);

		if (action.kind === "reload") {
			await this.load(currentFile, { force: true });
			this.invalidatePreviews(action.previewInvalidation);
			return;
		}

		if (action.kind === "preview-only") {
			this.invalidatePreviews(action.previewInvalidation);
			return;
		}

		// kind === "none" は何もしない
	}

	/**
	 * クリーンアップ
	 */
	destroy(): void {
		if (this.unsubscribeDataUpdate) {
			this.unsubscribeDataUpdate();
			this.unsubscribeDataUpdate = undefined;
		}
	}

	// Link data management
	load(file: TFile, options: { force?: boolean } = {}): Promise<void> {
		const activeLoad = this.activeLoad;
		if (!options.force && activeLoad?.filePath === file.path) {
			return activeLoad.promise;
		}

		const promise = this.executeLoad(file, options);
		const trackedPromise = promise.finally(() => {
			if (this.activeLoad?.promise === trackedPromise) {
				this.activeLoad = undefined;
			}
		});

		this.activeLoad = {
			filePath: file.path,
			promise: trackedPromise,
		};
		return trackedPromise;
	}

	private async executeLoad(
		file: TFile,
		options: { force?: boolean },
	): Promise<void> {
		const preparation = this.loader.prepareLoad(
			file,
			options,
			this.data !== undefined,
		);
		if (!preparation.shouldLoad || preparation.requestId === undefined) {
			return;
		}

		if (!preparation.isBackgroundRefresh) {
			this.mutableLoadState = {
				type: "loading",
				phase: "initial",
			};
		} else if (this.error) {
			// 背景更新では既存データを維持したまま、前回のエラー表示だけクリアする
			const previousData = getLoadedApplicationData(this.mutableLoadState);
			if (previousData) {
				this.mutableLoadState = {
					type: "loaded",
					...previousData,
				};
			}
		}

		const result = await this.loader.executeLoad(
			file,
			preparation.requestId,
			preparation.isBackgroundRefresh,
			preparation.isBackgroundRefresh
				? undefined
				: (progress) => this.applyResolveProgress(progress),
		);
		if (result.kind === "stale") {
			return;
		}

		if (result.kind === "success") {
			this.applyResolvedData(result.data, "complete");
			return;
		}

		if (result.isBackgroundRefresh) {
			const previousData = getLoadedApplicationData(this.mutableLoadState);
			this.mutableLoadState = {
				type: "error",
				error: result.error,
				previousData,
			};
		} else {
			this.mutableLoadState = {
				type: "error",
				error: result.error,
			};
		}
	}

	getSectionExpandedLimit(sectionId: string): number | undefined {
		return getSectionExpandedLimit(
			this.sectionExpandedLimits,
			this.settings,
			sectionId,
		);
	}

	setSectionExpandedLimit(sectionId: string, limit: number): void {
		const next = setSectionExpandedLimit(
			this.sectionExpandedLimits,
			sectionId,
			limit,
		);

		if (next !== this.sectionExpandedLimits) {
			this.sectionExpandedLimits = next;
		}
	}

	clearSectionExpandedLimit(sectionId: string): void {
		const next = clearSectionExpandedLimit(this.sectionExpandedLimits, sectionId);

		if (next !== this.sectionExpandedLimits) {
			this.sectionExpandedLimits = next;
		}
	}

	getDefaultSectionVisibleLimit(): number {
		return getDefaultSectionVisibleLimit(this.settings);
	}

	getSortOption(): SortOption {
		return this.sortOption;
	}

	getSortedTwoHopItems(items: TwoHopIndexedLink[]): TwoHopIndexedLink[] {
		return this.displayDataBuilder.getSortedTwoHopItems(items, this.sortOption);
	}

	getSortedTagGroupItems(items: TaggedNote[]): TaggedNote[] {
		return this.displayDataBuilder.getSortedTagGroupItems(items, this.sortOption);
	}

	getSortContextVersion(): number {
		return this.displayDataBuilder.getSortContextVersion();
	}

	setSortOption(sortOption: SortOption): void {
		const next = resolveSortOption(this.sortOption, sortOption);
		if (next !== this.sortOption) {
			this.onSortChange(next);
		}
		this.sortOption = next;
	}

	setContentSearchEnabled(enabled: boolean): void {
		this.onUpdateContentSearch(enabled);
	}

	// Settings management
	setSettings(settings: PluginSettings): void {
		const changedKeys = getChangedSettingKeys(this.settings, settings);
		const shouldRefreshDisplay = shouldRefreshDisplayData(changedKeys);
		this.settings = settings;
		if (shouldRefreshDisplay) {
			const loadedData = getLoadedApplicationData(this.mutableLoadState);
			if (loadedData) {
				const nextLoadedData = {
					...loadedData,
					displaySourceData: loadedData.data,
				};
				this.mutableLoadState =
					this.mutableLoadState.type === "error"
						? {
								...this.mutableLoadState,
								previousData: nextLoadedData,
							}
						: {
								type: "loaded",
								...nextLoadedData,
							};
			}
			this.updateVersion += 1;
		}
	}

	reset(): void {
		this.activeLoad = undefined;
		this.loader.reset();
		this.mutableLoadState = { type: "idle" };
		this.sortOption = this.settings.lastUsedSortOption;
		this.sectionExpandedLimits = {};
		this.previewGlobalVersion = 0;
		this.previewPathVersions = {};
	}

	private invalidatePreviews(previewInvalidation: PreviewInvalidation): void {
		if (!previewInvalidation) {
			return;
		}

		if (previewInvalidation === "all") {
			this.previewGlobalVersion += 1;
			return;
		}

		const nextPreviewPathVersions = { ...this.previewPathVersions };
		for (const path of previewInvalidation) {
			nextPreviewPathVersions[path] = (nextPreviewPathVersions[path] ?? 0) + 1;
		}
		this.previewPathVersions = nextPreviewPathVersions;
	}

	private applyResolveProgress(progress: ResolveProgress): void {
		const nextPhase = this.getLoadingPhaseForResolvePhase(progress.phase);
		this.applyResolvedData(progress.data, nextPhase);
	}

	private applyResolvedData(data: TwoHopLinkResult, loadingPhase: LoadedPhase): void {
		const previousLoadedData = getLoadedApplicationData(this.mutableLoadState);
		const previousDisplaySource = previousLoadedData?.displaySourceData;
		const nextDisplaySource = resolveNextDisplaySource(
			previousDisplaySource,
			data,
			loadingPhase,
			this.settings,
		);

		if (
			previousLoadedData?.data === data &&
			previousLoadedData.phase === loadingPhase &&
			this.mutableLoadState.type === "loaded"
		) {
			if (nextDisplaySource) {
				this.mutableLoadState = {
					type: "loaded",
					...previousLoadedData,
					displaySourceData: nextDisplaySource,
				};
				this.updateVersion += 1;
			}
			return;
		}

		this.mutableLoadState = {
			type: "loaded",
			phase: loadingPhase,
			data,
			displaySourceData: nextDisplaySource ?? previousDisplaySource ?? data,
		};
		if (nextDisplaySource) {
			this.updateVersion += 1;
		}
	}

	private getLoadingPhaseForResolvePhase(
		phase: ResolveProgress["phase"],
	): LoadedPhase {
		switch (phase) {
			case "base":
				return "base-ready";
			case "twohop":
				return "twohop-ready";
			case "complete":
				return "complete";
		}
	}
}
