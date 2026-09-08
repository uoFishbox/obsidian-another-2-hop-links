import type { MarkdownView, Plugin, TFile } from "obsidian";
import type { PluginSettings } from "settings/model";
import type { ResolveProgress, TwoHopLinkResult } from "two-hop/model";
import type { ResolveOptions } from "two-hop/resolution/TwoHopLinkResolver";
import type { IIndexingService } from "indexing/index-service/IndexingService";
import type { ISortService } from "cards/sorting";

export interface PluginIndexUpdateQueue {
	requestIndexUpdateForFile(path: string): void;
}

export interface PluginComponentController {
	mountComponentsForView(
		view: MarkdownView,
		file: TFile | undefined,
		options?: { skipIfMounted?: boolean },
	): void;
	unmountViewComponents(view: MarkdownView): void;
}

export interface PluginHost extends Plugin {
	settings: PluginSettings;
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
}
