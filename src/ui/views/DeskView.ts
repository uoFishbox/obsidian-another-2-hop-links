import {
	ItemView,
	WorkspaceLeaf,
	type IconName,
	type PaneType,
} from "obsidian";
import { mount, unmount } from "svelte";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { PluginHost } from "types/pluginHost";
import DeskBoard from "ui/components/desk/DeskBoard.svelte";
import type { SvelteComponentInstance } from "ui/views/shared/svelteLifecycle";

export const VIEW_TYPE_DESK = "cosense-card-links-desk-view";

interface DeskBoardComponent extends SvelteComponentInstance {
	refreshPaths?: (paths?: string[]) => void;
}

export class DeskView extends ItemView {
	private component: DeskBoardComponent | undefined = undefined;
	private lazyLoaderCache: Set<string> = new Set();
	private unsubscribeFromIndex: (() => void) | undefined = undefined;
	private refreshFrame: number | undefined = undefined;
	private pendingRefreshPaths: Set<string> | null | undefined = undefined;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: PluginHost,
	) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_DESK;
	}

	getDisplayText(): string {
		return "Desk";
	}

	getIcon(): IconName {
		return "layout-grid";
	}

	async onOpen(): Promise<void> {
		this.render();
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = this.plugin.indexingService.onDataUpdate(
			(context) => {
				const refreshPaths = this.getRefreshPathsForContext(context);
				if (refreshPaths !== undefined) {
					this.scheduleRefresh(refreshPaths);
				}
			},
		);
	}

	async onClose(): Promise<void> {
		this.unsubscribeFromIndex?.();
		this.unsubscribeFromIndex = undefined;
		if (this.refreshFrame !== undefined) {
			window.cancelAnimationFrame(this.refreshFrame);
			this.refreshFrame = undefined;
		}
		this.pendingRefreshPaths = undefined;
		if (this.component) {
			unmount(this.component);
			this.component = undefined;
		}
		this.lazyLoaderCache.clear();
	}

	public refreshFromSettings(): void {
		this.render();
	}

	private render(): void {
		if (this.component) {
			unmount(this.component);
			this.component = undefined;
		}

		this.contentEl.empty();
		this.component = mount(DeskBoard, {
			target: this.contentEl,
			props: {
				plugin: this.plugin,
				deskState: this.plugin.deskStore.getSnapshot(),
				lazyLoaderCache: this.lazyLoaderCache,
			},
		}) as DeskBoardComponent;
	}

	private getRefreshPathsForContext(
		context?: DataUpdateContext,
	): string[] | null | undefined {
		const cards = this.plugin.deskStore.getSnapshot().cards;
		if (cards.length === 0) {
			return undefined;
		}

		if (!context || context.affectsAll) {
			return null;
		}

		const affectedPaths = context.affectedPaths ?? [];
		if (affectedPaths.length === 0) {
			return null;
		}

		const deskPaths = new Set<string>();
		for (const card of cards) {
			deskPaths.add(card.path);
		}
		const refreshPaths = affectedPaths.filter((path) =>
			deskPaths.has(path),
		);
		return refreshPaths.length > 0 ? refreshPaths : undefined;
	}

	private scheduleRefresh(paths: string[] | null): void {
		if (paths === null) {
			this.pendingRefreshPaths = null;
		} else if (this.pendingRefreshPaths !== null) {
			const pending = this.pendingRefreshPaths ?? new Set<string>();
			for (const path of paths) {
				pending.add(path);
			}
			this.pendingRefreshPaths = pending;
		}

		if (this.refreshFrame !== undefined) {
			return;
		}

		this.refreshFrame = window.requestAnimationFrame(() => {
			const refreshPaths =
				this.pendingRefreshPaths === null
					? undefined
					: [...(this.pendingRefreshPaths ?? [])];
			this.pendingRefreshPaths = undefined;
			this.refreshFrame = undefined;
			if (this.component?.refreshPaths) {
				this.component.refreshPaths(refreshPaths);
				return;
			}
			this.render();
		});
	}
}

export async function openDeskView(
	plugin: PluginHost,
	newLeaf: PaneType | boolean = "tab",
): Promise<void> {
	const leaf = plugin.app.workspace.getLeaf(newLeaf);
	await leaf.setViewState({
		type: VIEW_TYPE_DESK,
		active: true,
	});
	plugin.app.workspace.revealLeaf(leaf);
}
