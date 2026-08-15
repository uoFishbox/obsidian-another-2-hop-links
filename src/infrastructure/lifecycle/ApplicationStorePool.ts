import type { IIndexingService } from "types/services";
import type { PluginSettings, SortOption } from "features/settings/model";
import type { DisplayDataBuilder } from "ui/stores/ApplicationStore.svelte";
import { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ResolveTwoHopLinks } from "features/two-hop/application/TwoHopLinksLoader";

export const RECENT_APPLICATION_STORE_LIMIT = 6;

export interface ApplicationStorePoolOptions {
	indexingService: IIndexingService;
	createDisplayDataBuilder: () => DisplayDataBuilder;
	updateSortOption: (option: SortOption) => void;
	updateContentSearch?: (enabled: boolean) => void;
}

/** Manages ApplicationStore ownership, reference counts, and idle LRU reuse. */
export class ApplicationStorePool {
	private readonly stores = new Map<string, ApplicationStore>();
	private readonly refCounts = new Map<string, number>();
	private readonly lastAccess = new Map<string, number>();
	private readonly displayDataBuilders = new Map<string, DisplayDataBuilder>();
	private accessSequence = 0;

	constructor(private readonly options: ApplicationStorePoolOptions) {}

	create(
		settings: PluginSettings,
		buildDisplayData: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore {
		const store = new ApplicationStore(
			settings,
			buildDisplayData,
			resolveTwoHopLinks,
			this.options.updateSortOption,
			this.options.updateContentSearch,
		);
		const unsubscribe = this.options.indexingService.onDataUpdate((context) => {
			store.handleDataUpdate(context);
		});
		store.subscribeToDataUpdates(unsubscribe);
		return store;
	}

	getOrCreateDisplayDataBuilder(leafId: string): DisplayDataBuilder {
		let displayDataBuilder = this.displayDataBuilders.get(leafId);
		if (!displayDataBuilder) {
			displayDataBuilder = this.options.createDisplayDataBuilder();
			this.displayDataBuilders.set(leafId, displayDataBuilder);
		}
		return displayDataBuilder;
	}

	acquire(
		leafId: string,
		filePath: string,
		settings: PluginSettings,
		buildDisplayData: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore {
		const key = buildStoreKey(leafId, filePath);
		let store = this.stores.get(key);
		if (!store) {
			store = this.create(settings, buildDisplayData, resolveTwoHopLinks);
			this.stores.set(key, store);
		}
		this.touch(key);
		this.refCounts.set(key, (this.refCounts.get(key) ?? 0) + 1);
		return store;
	}

	release(leafId: string, filePath: string): void {
		const key = buildStoreKey(leafId, filePath);
		if (!this.stores.has(key)) {
			this.refCounts.delete(key);
			return;
		}

		const nextRefCount = (this.refCounts.get(key) ?? 0) - 1;
		if (nextRefCount > 0) {
			this.refCounts.set(key, nextRefCount);
			return;
		}

		this.refCounts.set(key, 0);
		this.touch(key);
		this.trimIdleStores();
	}

	/** Releases one owner and destroys the store when it becomes idle. */
	dispose(leafId: string, filePath: string): void {
		const key = buildStoreKey(leafId, filePath);
		const store = this.stores.get(key);
		if (!store) {
			this.deleteEntry(key);
			this.maybeReleaseDisplayDataBuilder(leafId);
			return;
		}

		const nextRefCount = (this.refCounts.get(key) ?? 0) - 1;
		if (nextRefCount > 0) {
			this.refCounts.set(key, nextRefCount);
			return;
		}

		store.destroy();
		this.deleteEntry(key);
		this.maybeReleaseDisplayDataBuilder(leafId);
	}

	clearIdleStore(leafId: string, filePath: string): void {
		const key = buildStoreKey(leafId, filePath);
		if ((this.refCounts.get(key) ?? 0) > 0) return;

		this.stores.get(key)?.destroy();
		this.deleteEntry(key);
		this.maybeReleaseDisplayDataBuilder(leafId);
	}

	trimIdleStores(): void {
		const idleEntries: Array<{
			key: string;
			store: ApplicationStore;
			lastAccess: number;
		}> = [];
		for (const [key, store] of this.stores) {
			if ((this.refCounts.get(key) ?? 0) !== 0) {
				continue;
			}
			idleEntries.push({
				key,
				store,
				lastAccess: this.lastAccess.get(key) ?? 0,
			});
		}

		if (idleEntries.length <= RECENT_APPLICATION_STORE_LIMIT) return;

		idleEntries.sort((left, right) => left.lastAccess - right.lastAccess);
		const evictionCount = idleEntries.length - RECENT_APPLICATION_STORE_LIMIT;
		for (let index = 0; index < evictionCount; index += 1) {
			const { key, store } = idleEntries[index];
			store.destroy();
			this.deleteEntry(key);
			this.maybeReleaseDisplayDataBuilder(readLeafId(key));
		}
	}

	destroy(): void {
		for (const store of this.stores.values()) {
			store.destroy();
		}
		this.stores.clear();
		this.refCounts.clear();
		this.lastAccess.clear();
		this.displayDataBuilders.clear();
	}

	private touch(key: string): void {
		this.lastAccess.set(key, ++this.accessSequence);
	}

	private deleteEntry(key: string): void {
		this.stores.delete(key);
		this.refCounts.delete(key);
		this.lastAccess.delete(key);
	}

	private maybeReleaseDisplayDataBuilder(leafId: string): void {
		const prefix = `${leafId}:`;
		for (const key of this.stores.keys()) {
			if (key.startsWith(prefix)) return;
		}
		this.displayDataBuilders.delete(leafId);
	}
}

function buildStoreKey(leafId: string, filePath: string): string {
	return `${leafId}:${filePath}`;
}

function readLeafId(storeKey: string): string {
	const separatorIndex = storeKey.indexOf(":");
	return separatorIndex === -1 ? storeKey : storeKey.slice(0, separatorIndex);
}
