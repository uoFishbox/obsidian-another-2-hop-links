import type { TFile } from "obsidian";
import type { PluginSettings } from "features/settings/model";
import type { SortOption } from "core/sorting";
import type { ResolveProgress, TwoHopLinkResult } from "types";
import type { TaggedNote, TwoHopIndexedLink } from "types/domain";
import type {
	DisplayData,
	DisplayDataBuilder,
	PreprocessedDisplayData,
} from "features/two-hop/application/displayDataBuilder";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type {
	TwoHopResolveSnapshot,
	TwoHopResolverDependencies,
} from "features/two-hop/domain/ResolverDependencies";
import {
	computePreprocessedDisplayDataState,
	computeSortedDisplayDataState,
	createPreprocessedDisplayDataCache,
	type ComputedDisplayData,
	type PreprocessedDisplayDataCache,
} from "features/two-hop/application/DisplayStateCalculator";
import { decideDataUpdateAction } from "features/two-hop/application/dataUpdateReloadDecider";
import {
	type ResolveTwoHopLinks,
	TwoHopLinksLoader,
} from "features/two-hop/application/TwoHopLinksLoader";
import { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";

export type { DisplayDataBuilder } from "features/two-hop/application/displayDataBuilder";

export type LoadingPhase =
	| "idle"
	| "initial"
	| "base-ready"
	| "twohop-ready"
	| "complete";

export type LoadedPhase = Exclude<LoadingPhase, "idle" | "initial">;

export interface LoadedTwoHopData {
	phase: LoadedPhase;
	data: TwoHopLinkResult;
	dependencies: TwoHopResolverDependencies | undefined;
}

export type TwoHopLoadState =
	| { type: "idle" }
	| { type: "loading"; phase: "initial" }
	| ({ type: "loaded" } & LoadedTwoHopData)
	| { type: "error"; error: Error; previousData?: LoadedTwoHopData };

interface ActiveApplicationLoad {
	filePath: string;
	promise: Promise<void>;
}

function getLoadedApplicationData(
	state: TwoHopLoadState,
): LoadedTwoHopData | undefined {
	if (state.type === "loaded") {
		return state;
	}
	if (state.type === "error") {
		return state.previousData;
	}
	return undefined;
}

function getLoadingPhase(state: TwoHopLoadState): LoadingPhase {
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

function getLoadError(state: TwoHopLoadState): Error | undefined {
	return state.type === "error" ? state.error : undefined;
}

/**
 * Owns two-hop loading, resolver dependencies, and derived display data.
 * Shared view and preview state is composed through `uiState`.
 */
export class TwoHopApplicationStore {
	readonly uiState: ApplicationUiState;
	declare readonly loadState: TwoHopLoadState;
	declare readonly loading: boolean;
	declare readonly loadingPhase: LoadingPhase;
	declare readonly data: TwoHopLinkResult | undefined;
	declare readonly error: Error | undefined;
	declare displayState: ComputedDisplayData;
	declare displayData: DisplayData;
	declare hasDisplayableItems: boolean;

	declare private preprocessedDisplayData: PreprocessedDisplayData;
	declare private computedDisplayData: ComputedDisplayData;
	declare private displayDataBuilder: DisplayDataBuilder;
	declare private mutableLoadState: TwoHopLoadState;
	private readonly preprocessedDisplayDataCache: PreprocessedDisplayDataCache;
	private readonly loader: TwoHopLinksLoader;
	private unsubscribeDataUpdate: (() => void) | undefined = undefined;
	private activeLoad: ActiveApplicationLoad | undefined;

	constructor(
		initialSettings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
		onSortChange: (newSortOption: SortOption) => void,
		onUpdateContentSearch: (enabled: boolean) => void = () => {},
	) {
		this.uiState = new ApplicationUiState(
			initialSettings,
			onSortChange,
			onUpdateContentSearch,
		);
		this.displayDataBuilder = displayDataBuilder;
		this.loader = new TwoHopLinksLoader(resolveTwoHopLinks);
		this.preprocessedDisplayDataCache = createPreprocessedDisplayDataCache();

		// 大きなオブジェクトは深いプロキシを避け、union 全体の再代入だけで更新する
		this.mutableLoadState = $state.raw<TwoHopLoadState>({
			type: "loading",
			phase: "initial",
		});
		this.loadState = $derived(this.mutableLoadState);
		this.loading = $derived(this.loadState.type === "loading");
		this.loadingPhase = $derived(getLoadingPhase(this.loadState));
		this.data = $derived(getLoadedApplicationData(this.loadState)?.data);
		this.error = $derived(getLoadError(this.loadState));
		// data/settings 依存の前処理を先に計算し、sortOption 変更時は再利用する
		this.preprocessedDisplayData = $derived.by(
			(): PreprocessedDisplayData =>
				computePreprocessedDisplayDataState(
					this.displayDataBuilder,
					this.data,
					this.uiState.settings,
					this.preprocessedDisplayDataCache,
				),
		);

		// ソート段のみを sortOption 依存で再計算する
		this.computedDisplayData = $derived.by(
			(): ComputedDisplayData =>
				computeSortedDisplayDataState(
					this.displayDataBuilder,
					this.preprocessedDisplayData,
					this.uiState.settings,
					this.uiState.sortOption,
				),
		);
		this.displayState = $derived(this.computedDisplayData);
		this.displayData = $derived(this.displayState.displayData);
		this.hasDisplayableItems = $derived(this.displayState.hasDisplayableItems);
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
			this.uiState.triggerUpdate();
			return;
		}

		const reloadDecisionInput = {
			currentFile,
			dependencies: getLoadedApplicationData(this.mutableLoadState)?.dependencies,
			context,
		};

		const action = decideDataUpdateAction(reloadDecisionInput);

		if (action.kind === "reload") {
			await this.load(currentFile, { force: true });
			this.uiState.invalidatePreviews(action.previewInvalidation);
			return;
		}

		if (action.kind === "preview-only") {
			this.uiState.invalidatePreviews(action.previewInvalidation);
			return;
		}

		// kind === "none" は何もしない
	}

	/**
	 * クリーンアップ
	 */
	destroy(): void {
		this.loader.reset();
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
		if (!preparation.shouldLoad) return;

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
			preparation.signal,
			preparation.isBackgroundRefresh
				? undefined
				: (progress) => this.applyResolveProgress(progress),
		);
		if (result.kind === "stale") {
			return;
		}

		if (result.kind === "success") {
			this.applyResolvedSnapshot(result.snapshot);
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

	getSortedTwoHopItems(
		items: readonly TwoHopIndexedLink[],
	): readonly TwoHopIndexedLink[] {
		return this.displayDataBuilder.getSortedTwoHopItems(
			items,
			this.uiState.sortOption,
		);
	}

	getSortedTagGroupItems(items: readonly TaggedNote[]): readonly TaggedNote[] {
		return this.displayDataBuilder.getSortedTagGroupItems(
			items,
			this.uiState.sortOption,
		);
	}

	getSortContextVersion(): number {
		return this.displayDataBuilder.getSortContextVersion();
	}

	reset(): void {
		this.activeLoad = undefined;
		this.loader.reset();
		this.mutableLoadState = { type: "idle" };
		this.uiState.reset();
	}

	private applyResolveProgress(progress: ResolveProgress): void {
		const nextPhase = this.getLoadingPhaseForResolvePhase(progress.phase);
		this.applyResolvedData(progress.data, nextPhase, undefined);
	}

	private applyResolvedSnapshot(snapshot: TwoHopResolveSnapshot): void {
		this.applyResolvedData(snapshot.result, "complete", snapshot.dependencies);
	}

	private applyResolvedData(
		data: TwoHopLinkResult,
		loadingPhase: LoadedPhase,
		dependencies: TwoHopResolverDependencies | undefined,
	): void {
		const previousLoadedData = getLoadedApplicationData(this.mutableLoadState);

		if (
			previousLoadedData?.data === data &&
			previousLoadedData.phase === loadingPhase &&
			previousLoadedData.dependencies === dependencies &&
			this.mutableLoadState.type === "loaded"
		) {
			return;
		}

		this.mutableLoadState = {
			type: "loaded",
			phase: loadingPhase,
			data,
			dependencies,
		};
		if (previousLoadedData?.data !== data) {
			this.uiState.triggerUpdate();
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
