import type { App, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_ALL_NOTES } from "search/all-notes/AllNotesView";
import { getLeafId } from "obsidian-integration/workspace/workspaceLeafIdentity";
import type { PluginHost } from "obsidian-integration/pluginHost";

const EMPTY_VIEW_TYPE = "empty";
const EMPTY_VIEW_SETTLE_MS = 150;

interface PendingEmptyLeaf {
	leaf: WorkspaceLeaf;
	timerId: number;
}

export interface EmptyViewController {
	sync(): void;
	destroy(): void;
	refresh(): void;
}

export function createEmptyViewController(
	app: App,
	plugin: PluginHost,
): EmptyViewController {
	const pendingByLeafId = new Map<string, PendingEmptyLeaf>();

	function getViewType(leaf: WorkspaceLeaf): string {
		return leaf.getViewState().type;
	}

	function cancelPendingLeaf(leafId: string): void {
		const pending = pendingByLeafId.get(leafId);
		if (!pending) {
			return;
		}

		window.clearTimeout(pending.timerId);
		pendingByLeafId.delete(leafId);
	}

	function cancelAllPending(): void {
		for (const leafId of pendingByLeafId.keys()) {
			cancelPendingLeaf(leafId);
		}
	}

	function getCurrentMainLeaf(): WorkspaceLeaf | null {
		return app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
	}

	function isCurrentMainLeaf(leaf: WorkspaceLeaf): boolean {
		return getCurrentMainLeaf() === leaf;
	}

	function openAllNotesView(leaf: WorkspaceLeaf): void {
		void leaf
			.setViewState({
				type: VIEW_TYPE_ALL_NOTES,
			})
			.catch((error) => {
				console.error(
					"[Cosense card links] Failed to open All notes view:",
					error,
				);
			});
	}

	function confirmPendingLeaf(leafId: string): void {
		const pending = pendingByLeafId.get(leafId);
		if (!pending) {
			return;
		}
		pendingByLeafId.delete(leafId);

		if (!plugin.settings.enableEmptyViewAllNotesInNewTab) {
			return;
		}
		if (!isCurrentMainLeaf(pending.leaf)) {
			return;
		}
		if (getViewType(pending.leaf) !== EMPTY_VIEW_TYPE) {
			return;
		}

		openAllNotesView(pending.leaf);
	}

	function scheduleEmptyLeaf(leaf: WorkspaceLeaf): void {
		const leafId = getLeafId(leaf);
		if (!leafId || pendingByLeafId.has(leafId)) {
			return;
		}

		const timerId = window.setTimeout(() => {
			confirmPendingLeaf(leafId);
		}, EMPTY_VIEW_SETTLE_MS);
		pendingByLeafId.set(leafId, { leaf, timerId });
	}

	function restoreAllNotesViewsToEmpty(): void {
		for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_ALL_NOTES)) {
			void leaf.setViewState({ type: EMPTY_VIEW_TYPE }).catch((error) => {
				console.error(
					"[Cosense card links] Failed to restore the empty view:",
					error,
				);
			});
		}
	}

	function sync(): void {
		if (!plugin.settings.enableEmptyViewAllNotesInNewTab) {
			cancelAllPending();
			restoreAllNotesViewsToEmpty();
			return;
		}

		const currentMainLeaf = getCurrentMainLeaf();
		if (!currentMainLeaf) {
			cancelAllPending();
			return;
		}

		const currentMainLeafId = getLeafId(currentMainLeaf);
		for (const leafId of pendingByLeafId.keys()) {
			if (leafId !== currentMainLeafId) {
				cancelPendingLeaf(leafId);
			}
		}

		if (getViewType(currentMainLeaf) !== EMPTY_VIEW_TYPE) {
			if (currentMainLeafId) {
				cancelPendingLeaf(currentMainLeafId);
			}
			return;
		}

		scheduleEmptyLeaf(currentMainLeaf);
	}

	function destroy(): void {
		cancelAllPending();
	}

	function refresh(): void {
		sync();
	}

	return { sync, destroy, refresh };
}
