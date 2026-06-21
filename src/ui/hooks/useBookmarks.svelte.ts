import { Component, normalizePath, type App } from "obsidian";
import { SvelteSet } from "svelte/reactivity";
import type { BookmarksState } from "ui/context/linkContext";
import { parseBookmarkedFilePaths } from "./bookmarksUtils";
import { enableLogging, logger } from "utils/logger";

const BOOKMARKS_RELOAD_DEBOUNCE_MS = 120;

export function useBookmarks(app: App): BookmarksState {
	const bookmarksStore = getBookmarksStore(app);

	$effect(() => {
		const release = bookmarksStore.acquire();
		return () => release();
	});

	return {
		get filePaths() {
			return bookmarksStore.filePaths;
		},
		get orderedFilePaths() {
			return bookmarksStore.orderedFilePaths;
		},
		isBookmarked(path: string | null | undefined): boolean {
			return bookmarksStore.isBookmarked(path);
		},
	};
}

class BookmarksStore {
	readonly filePaths = new SvelteSet<string>();
	orderedFilePaths: string[] = [];
	private component: Component | null = null;
	private reloadTimer: ReturnType<typeof setTimeout> | null = null;
	private consumerCount = 0;
	private loadRequestId = 0;

	constructor(
		private readonly app: App,
		private readonly bookmarksPath: string,
	) {}

	acquire(): () => void {
		this.consumerCount += 1;
		this.ensureStarted();

		return () => {
			if (this.consumerCount > 0) {
				this.consumerCount -= 1;
			}

			if (this.consumerCount === 0) {
				this.stop();
			}
		};
	}

	isBookmarked(path: string | null | undefined): boolean {
		if (!path) {
			return false;
		}
		return this.filePaths.has(normalizePath(path));
	}

	private ensureStarted(): void {
		if (this.component) {
			return;
		}

		const component = new Component();
		if (enableLogging) logger(`[Bookmarks] watcher initialized`);
		void this.loadBookmarks();

		// パッチャーから発火されるカスタムイベントをリッスンするだけにする
		component.registerEvent(
			this.app.workspace.on("cosense-card-links:bookmarks-updated" as any, () => {
				this.scheduleReload("workspace-event");
			}),
		);

		this.component = component;
	}

	private stop(): void {
		this.clearReloadTimer();
		this.loadRequestId += 1;
		this.component?.unload();
		this.component = null;
	}

	private clearReloadTimer(): void {
		if (!this.reloadTimer) {
			return;
		}

		clearTimeout(this.reloadTimer);
		this.reloadTimer = null;
	}

	private scheduleReload(trigger: string): void {
		this.clearReloadTimer();
		if (enableLogging) logger(`[Bookmarks] schedule reload (trigger=${trigger})`);
		this.reloadTimer = setTimeout(() => {
			this.reloadTimer = null;
			void this.loadBookmarks();
		}, BOOKMARKS_RELOAD_DEBOUNCE_MS);
	}

	private async loadBookmarks(): Promise<void> {
		const loadRequestId = this.loadRequestId + 1;
		this.loadRequestId = loadRequestId;

		try {
			const exists = await this.app.vault.adapter.exists(this.bookmarksPath);
			if (loadRequestId !== this.loadRequestId) {
				return;
			}

			if (!exists) {
				this.filePaths.clear();
				this.orderedFilePaths = [];
				if (enableLogging) logger(`[Bookmarks] file not found. Cleared bookmark state.`);
				return;
			}

			const content = await this.app.vault.adapter.read(this.bookmarksPath);
			if (loadRequestId !== this.loadRequestId) {
				return;
			}

			const parsed = parseBookmarkedFilePaths(content);
			this.filePaths.clear();
			for (const path of parsed.filePaths) {
				this.filePaths.add(path);
			}
			this.orderedFilePaths = parsed.orderedFilePaths;
			if (enableLogging) logger(`[Bookmarks] reloaded ${this.filePaths.size} bookmarks.`);
		} catch (error) {
			if (loadRequestId !== this.loadRequestId) {
				return;
			}

			this.filePaths.clear();
			this.orderedFilePaths = [];
			if (enableLogging) logger(`[Bookmarks] failed to reload bookmarks`, error);
		}
	}
}

const bookmarksStoreByApp = new WeakMap<App, BookmarksStore>();

function getBookmarksStore(app: App): BookmarksStore {
	let bookmarksStore = bookmarksStoreByApp.get(app);

	if (!bookmarksStore) {
		bookmarksStore = new BookmarksStore(
			app,
			normalizePath(`${app.vault.configDir}/bookmarks.json`),
		);
		bookmarksStoreByApp.set(app, bookmarksStore);
	}

	return bookmarksStore;
}
