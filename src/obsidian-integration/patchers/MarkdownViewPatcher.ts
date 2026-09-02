import type { PluginHost } from "obsidian-integration/pluginHost";
import { MarkdownView, TFile } from "obsidian";
import { getActiveInlineContainer } from "shared/ui/dom/domUtils";
import { applyPatch } from "obsidian-integration/capabilities/applyPatch";
import {
	handleMarkdownEditorBackspace,
	handleMarkdownEditorPageUp,
	handleMarkdownInlineTitleEnter,
} from "obsidian-integration/navigation/markdownTitleEditorNavigationBridge";

export function initFilePatcher(plugin: PluginHost): void {
	patchViewLifecycle(plugin);
}

function patchViewLifecycle(plugin: PluginHost) {
	const titleEditorNavigationBridgeViews = new WeakSet<MarkdownView>();

	const ensureTitleEditorNavigationBridge = (view: MarkdownView): void => {
		if (titleEditorNavigationBridgeViews.has(view)) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent): void => {
			if (!plugin.settings.experimentalCosenseTitleEditing) {
				return;
			}

			if (handleMarkdownInlineTitleEnter(view, event)) {
				return;
			}

			if (handleMarkdownEditorBackspace(view, event)) {
				return;
			}

			handleMarkdownEditorPageUp(view, event);
		};
		view.containerEl.addEventListener("keydown", onKeyDown, true);
		titleEditorNavigationBridgeViews.add(view);

		plugin.register(() => {
			view.containerEl.removeEventListener("keydown", onKeyDown, true);
			titleEditorNavigationBridgeViews.delete(view);
		});
	};

	const ensureInlineContainers = (view: MarkdownView): void => {
		if (
			plugin.settings.displayMode !== "editor-inline" &&
			plugin.settings.displayMode !== "hybrid"
		) {
			return;
		}

		getActiveInlineContainer(view);
	};

	applyPatch(plugin, {
		id: "markdown-view:lifecycle",
		target: MarkdownView.prototype,
		method: "onload",
		wrap: (next) =>
			function (this: MarkdownView) {
				const result = next.call(this);
				try {
					ensureTitleEditorNavigationBridge(this);
					ensureInlineContainers(this);
				} catch (e) {
					console.error(
						"[FilePatcher] Failed to inject container in onload",
						e,
					);
				}
				return result;
			},
	});

	applyPatch(plugin, {
		id: "markdown-view:onLoadFile",
		target: MarkdownView.prototype,
		method: "onLoadFile",
		wrap: (next) =>
			async function (this: MarkdownView, file: TFile) {
				const result = await next.call(this, file);
				ensureTitleEditorNavigationBridge(this);
				if (this.file?.path === file.path) {
					ensureInlineContainers(this);
				}

				return result;
			},
	});

	plugin.app.workspace.iterateAllLeaves((leaf) => {
		if (leaf.view instanceof MarkdownView) {
			ensureTitleEditorNavigationBridge(leaf.view);
		}
	});

	applyPatch(plugin, {
		id: "markdown-view:onUnloadFile",
		target: MarkdownView.prototype,
		method: "onUnloadFile",
		wrap: (next) =>
			async function (this: MarkdownView, file: TFile) {
				plugin.componentController.unmountViewComponents(this);
				return await next.call(this, file);
			},
	});
}
