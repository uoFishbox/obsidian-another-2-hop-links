import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import type { PluginHostUi } from "types/pluginHostUi";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ComponentInstance } from "infrastructure/lifecycle/ComponentController";
import AllNotesPage from "features/all-notes/ui/AllNotesPage.svelte";
import { getLeafId } from "infrastructure/workspace/workspaceLeafIdentity";
import { areTagFeaturesEnabled } from "features/settings/model";

interface MountedEmptyView {
	component: ComponentInstance | undefined;
	hostEl: HTMLElement;
	rootEl: HTMLElement;
	applicationStore: ApplicationStore;
}

export interface EmptyViewController {
	sync(): void;
	destroy(): void;
	refresh(): void;
}

export function createEmptyViewController(
	app: App,
	plugin: PluginHostUi,
): EmptyViewController {
	const mountedByLeafId = new Map<string, MountedEmptyView>();

	function isEmptyLeaf(leaf: WorkspaceLeaf): boolean {
		const view = leaf.view as { getViewType?: () => string } | null;
		return typeof view?.getViewType === "function"
			? view.getViewType() === "empty"
			: false;
	}

	function resolveHostElement(leaf: WorkspaceLeaf): HTMLElement | null {
		const containerEl = leaf.view?.containerEl;
		if (!containerEl) {
			return null;
		}

		const directChild = containerEl.querySelector(":scope > .view-content");
		if (directChild instanceof HTMLElement) {
			return directChild;
		}

		const fallback = containerEl.querySelector(".view-content");
		return fallback instanceof HTMLElement ? fallback : null;
	}

	function createSourceFileForContext(): TFile {
		const activeFile = app.workspace.getActiveFile();
		if (activeFile instanceof TFile) {
			return activeFile;
		}

		const firstMarkdownFile = app.vault.getMarkdownFiles()[0];
		if (firstMarkdownFile instanceof TFile) {
			return firstMarkdownFile;
		}

		return { path: "" } as TFile;
	}

	function unmountLeaf(leafId: string): void {
		const mounted = mountedByLeafId.get(leafId);
		if (!mounted) {
			return;
		}

		if (mounted.component) {
			unmount(mounted.component);
		}

		mounted.applicationStore.destroy();
		mounted.rootEl.remove();
		mounted.hostEl.classList.remove("cosense-card-links-empty-view-host");
		mountedByLeafId.delete(leafId);
	}

	function mountLeaf(leaf: WorkspaceLeaf, leafId: string): void {
		const hostEl = resolveHostElement(leaf);
		if (!hostEl) {
			return;
		}

		hostEl.classList.add("cosense-card-links-empty-view-host");

		const rootEl = document.createElement("div");
		rootEl.className = "cosense-card-links-empty-view-root";
		hostEl.appendChild(rootEl);

		const sourceFile = createSourceFileForContext();
		const linkContextFactory = plugin.getLinkContextFactory();
		const linkContext = linkContextFactory(sourceFile, plugin.settings);

		const displayDataBuilder = plugin.createDisplayDataBuilder();
		const applicationStore = plugin.createApplicationStore(
			plugin.settings,
			displayDataBuilder,
			(file: TFile, _onProgress, signal) =>
				plugin.getTwoHopLinkResult(file, undefined, {
					includeTaggedNotes:
						areTagFeaturesEnabled(plugin.settings) &&
						plugin.settings.showTagsSection,
					signal,
				}),
		);

		const component = mount(AllNotesPage, {
			target: rootEl,
			props: {
				app,
				settings: plugin.settings,
				sortService: plugin.sortService,
				linkContext,
				applicationStore,
				previewRuntime: plugin.getPreviewRuntime?.(),
			},
		}) as ComponentInstance;

		mountedByLeafId.set(leafId, {
			component,
			hostEl,
			rootEl,
			applicationStore,
		});
	}

	function sync(): void {
		if (!plugin.settings.enableEmptyViewAllNotesInNewTab) {
			destroy();
			return;
		}

		const activeLeafIds = new Set<string>();

		app.workspace.iterateAllLeaves((leaf) => {
			if (!isEmptyLeaf(leaf)) {
				return;
			}

			const leafId = getLeafId(leaf);
			if (!leafId) {
				return;
			}

			activeLeafIds.add(leafId);

			const existing = mountedByLeafId.get(leafId);
			if (existing?.hostEl.isConnected && existing.rootEl.isConnected) {
				return;
			}

			if (existing) {
				unmountLeaf(leafId);
			}

			mountLeaf(leaf, leafId);
		});

		for (const leafId of mountedByLeafId.keys()) {
			if (!activeLeafIds.has(leafId)) {
				unmountLeaf(leafId);
			}
		}
	}

	function destroy(): void {
		for (const leafId of mountedByLeafId.keys()) {
			unmountLeaf(leafId);
		}
	}

	function refresh(): void {
		if (!plugin.settings.enableEmptyViewAllNotesInNewTab) {
			return;
		}

		destroy();
		sync();
	}

	return { sync, destroy, refresh };
}
