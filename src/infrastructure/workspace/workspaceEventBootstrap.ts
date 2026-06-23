import type { Workspace } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import type { FrameScheduler } from "infrastructure/lifecycle/frameScheduler";
import type { DOMMutationObserver } from "infrastructure/observers/DOMMutationObserver";
import type { EmptyViewController } from "infrastructure/lifecycle/emptyViewController";
import type { PropertyWidgetStyler } from "features/link-decoration/propertyWidgetStyler";
import type { DisplayModeController } from "features/display-mode/DisplayModeController";
import type { ViewUpdateOrchestrator } from "infrastructure/lifecycle/viewUpdateOrchestrator";
import type { ScrollManager } from "infrastructure/workspace/ScrollHistoryState";

export interface WorkspaceEventBootstrapDeps {
	readonly workspace: Workspace;
	readonly frameScheduler: FrameScheduler;
	readonly domMutationObserver: DOMMutationObserver;
	readonly emptyViewController: EmptyViewController;
	readonly propertyWidgetStyler: PropertyWidgetStyler;
	readonly displayModeManager: DisplayModeController;
	readonly viewUpdateOrchestrator: ViewUpdateOrchestrator;
	readonly scrollManager: ScrollManager;
	readonly isUnloaded: () => boolean;
}

/**
 * Wires up the workspace/vault event handlers that drive view refreshes,
 * decoration updates and scroll-history cleanup.
 *
 * The coalescing schedulers (decoration refresh, post-paint work, layout
 * change) are local to this function so their queue flags stay enclosed and
 * do not leak onto the plugin instance.
 *
 * Must be called after layout ready and after the DOM mutation observer and
 * empty view controller have been initialized.
 */
export function setupWorkspaceEventHandlers(
	plugin: PluginHost,
	deps: WorkspaceEventBootstrapDeps,
): void {
	let isDecorationRefreshQueued = false;
	let isPostPaintViewWorkQueued = false;
	let isLayoutChangeQueued = false;

	const scheduleDecorationRefresh = (): void => {
		if (deps.isUnloaded()) return;
		if (isDecorationRefreshQueued) return;
		isDecorationRefreshQueued = true;

		const flushDecorationRefresh = (): void => {
			isDecorationRefreshQueued = false;
			deps.viewUpdateOrchestrator.updateActiveMarkdownViewDecorations();
		};

		deps.frameScheduler.scheduleIdleOrNextFrame(flushDecorationRefresh, {
			timeout: 200,
		});
	};

	const schedulePostPaintViewWork = (): void => {
		if (deps.isUnloaded()) return;
		if (isPostPaintViewWorkQueued) return;
		isPostPaintViewWorkQueued = true;

		deps.frameScheduler.scheduleAfterFirstPaint(() => {
			isPostPaintViewWorkQueued = false;
			deps.domMutationObserver.initObservers();
			scheduleDecorationRefresh();
		});
	};

	const handleLayoutChange = (): void => {
		if (deps.isUnloaded()) return;
		deps.displayModeManager.handleActiveLeafChange();
		schedulePostPaintViewWork();
	};

	const scheduleLayoutChange = (): void => {
		if (deps.isUnloaded()) return;
		if (isLayoutChangeQueued) return;
		isLayoutChangeQueued = true;

		const flushLayoutChange = (): void => {
			isLayoutChangeQueued = false;
			handleLayoutChange();
		};

		deps.frameScheduler.scheduleOnNextFrame(flushLayoutChange);
	};

	plugin.registerEvent(
		deps.workspace.on("layout-change", () => {
			deps.emptyViewController.sync();
			deps.propertyWidgetStyler.pruneDisconnected();
			schedulePostPaintViewWork();
		}),
	);

	plugin.registerEvent(deps.workspace.on("active-leaf-change", scheduleLayoutChange));

	plugin.registerEvent(deps.workspace.on("file-open", scheduleLayoutChange));

	plugin.registerEvent(
		deps.workspace.on("file-open", () => {
			const activeLeaf = deps.workspace.getLeaf(false);
			if (activeLeaf) {
				deps.scrollManager.clearHistory(activeLeaf.id);
			}
		}),
	);
}
