import { MarkdownView, TFile } from "obsidian";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import type { ScrollManager } from "obsidian-integration/workspace/ScrollHistoryState";
import type { KeyboardCardNavigator } from "obsidian-integration/navigation/KeyboardCardNavigator";
import type { LinkStatusService } from "obsidian-integration/link-decoration/linkStatusService";
import type { IndexingService } from "indexing/index-service/IndexingService";
import type { StylingService } from "obsidian-integration/link-decoration/stylingService";
import type { RenderedMdElementsRegistry } from "obsidian-integration/markdown/RenderedMdElementsRegistry";
import { buildLivePreviewPlugin } from "obsidian-integration/markdown/livePreview";
import { buildEditorInlineFocusBridgeExtension } from "obsidian-integration/navigation/editorInlineFocusBridge";
import { markdownPostProcessor } from "obsidian-integration/markdown/markdownHandlers";
import { downloadAsFile, exportToClipboard } from "two-hop/export/exportService";
import { TwoHopLinksView, TWO_HOP_LINKS_VIEW_TYPE } from "two-hop/ui/TwoHopLinksView";
import {
	PreCreationView,
	VIEW_TYPE_PRE_CREATE,
} from "two-hop/pre-creation/PreCreationView";
import { TagNotesView, VIEW_TYPE_TAG_NOTES } from "search/tag-notes/TagNotesView";
import { AllNotesView, VIEW_TYPE_ALL_NOTES } from "search/all-notes/AllNotesView";
import {
	COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "hover-popover/hoverPopoverLinkSpec";
import { CosenseCardLinksSettingTab } from "settings/ui/SettingTab";
import { registerCardDragStateCleanup } from "cards/interactions/cardDragState";

/** Collaborators required while registering plugin-owned Obsidian surfaces. */
export interface RegisterPluginSurfacesDeps {
	readonly viewServices: ViewServices;
	readonly scrollManager: ScrollManager;
	readonly keyboardCardNavigator: KeyboardCardNavigator;
	readonly linkStatusService: LinkStatusService;
	readonly indexingService: IndexingService;
	readonly stylingService: StylingService;
	readonly renderedMdElementsRegistry: RenderedMdElementsRegistry;
}

/** Registers the Obsidian surfaces owned by the plugin. */
export function registerPluginSurfaces(
	plugin: PluginHost,
	deps: RegisterPluginSurfacesDeps,
): void {
	registerCardDragStateCleanup(plugin);
	plugin.addSettingTab(new CosenseCardLinksSettingTab(plugin.app, plugin));
	registerViews(plugin, deps.viewServices);
	registerCommands(plugin, deps);
	registerEditorExtensions(plugin, deps.linkStatusService);
	registerMarkdownProcessors(plugin, deps);
	registerFileMenu(plugin);
}

function registerViews(plugin: PluginHost, viewServices: ViewServices): void {
	plugin.registerView(
		TWO_HOP_LINKS_VIEW_TYPE,
		(leaf) => new TwoHopLinksView(leaf, plugin, viewServices),
	);
	plugin.registerView(
		VIEW_TYPE_PRE_CREATE,
		(leaf) => new PreCreationView(leaf, plugin, viewServices),
	);
	plugin.registerView(
		VIEW_TYPE_TAG_NOTES,
		(leaf) => new TagNotesView(leaf, plugin, viewServices),
	);
	plugin.registerView(
		VIEW_TYPE_ALL_NOTES,
		(leaf) => new AllNotesView(leaf, plugin, viewServices),
	);
	plugin.registerHoverLinkSource(COSENSE_CARD_LINKS_HOVER_SOURCE_ID, {
		display: COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
		defaultMod: true,
	});
}

function registerCommands(plugin: PluginHost, deps: RegisterPluginSurfacesDeps): void {
	plugin.addCommand({
		id: "toggle-scroll-to-two-hop-links",
		name: "Scroll to Two Hop Links and focus search",
		checkCallback: (checking: boolean) => {
			const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const isInlineMode =
				plugin.settings.displayMode === "editor-inline" ||
				plugin.settings.displayMode === "hybrid";

			if (!activeView || !isInlineMode) {
				return false;
			}
			if (!checking) {
				deps.scrollManager.toggleScroll(activeView);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "activate-card-keyboard-mode",
		name: "Activate keyboard card navigation",
		callback: () => {
			deps.keyboardCardNavigator.toggle();
		},
	});
}

function registerEditorExtensions(
	plugin: PluginHost,
	linkStatusService: LinkStatusService,
): void {
	plugin.registerEditorExtension(buildLivePreviewPlugin(linkStatusService));
	plugin.registerEditorExtension(buildEditorInlineFocusBridgeExtension(plugin));
}

function registerMarkdownProcessors(
	plugin: PluginHost,
	deps: RegisterPluginSurfacesDeps,
): void {
	plugin.registerMarkdownPostProcessor((el, ctx) =>
		markdownPostProcessor(
			el,
			ctx,
			plugin.app,
			deps.indexingService,
			deps.stylingService,
			deps.renderedMdElementsRegistry,
		),
	);
}

function registerFileMenu(plugin: PluginHost): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFile)) return;

			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("Copy 2-hop links to clipboard")
					.setIcon("copy")
					.setSection("action")
					.onClick(async () => {
						const result = await plugin.getTwoHopLinkResult(file);
						await exportToClipboard(plugin.app, result);
					});
			});

			menu.addItem((item) => {
				item.setTitle("Export 2-hop links to file")
					.setIcon("download")
					.setSection("action")
					.onClick(async () => {
						const result = await plugin.getTwoHopLinkResult(file);
						await downloadAsFile(plugin.app, result);
					});
			});
		}),
	);
}
