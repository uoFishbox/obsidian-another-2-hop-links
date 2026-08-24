import { MarkdownView, TFile } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import type { ViewServices } from "ui/shared/views/viewServices";
import type { ScrollManager } from "infrastructure/workspace/ScrollHistoryState";
import type { KeyboardCardNavigator } from "features/keyboard-navigation/KeyboardCardNavigator";
import type { LinkStatusService } from "features/link-decoration/linkStatusService";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { StylingService } from "features/link-decoration/stylingService";
import type { RenderedMdElementsRegistry } from "infrastructure/markdown/RenderedMdElementsRegistry";
import { buildLivePreviewPlugin } from "infrastructure/markdown/livePreview";
import { buildEditorInlineFocusBridgeExtension } from "features/keyboard-navigation/editorInlineFocusBridge";
import { markdownPostProcessor } from "infrastructure/markdown/markdownHandlers";
import { downloadAsFile, exportToClipboard } from "features/export/exportService";
import {
	TwoHopLinksView,
	TWO_HOP_LINKS_VIEW_TYPE,
} from "features/two-hop/ui/TwoHopLinksView";
import {
	PreCreationView,
	VIEW_TYPE_PRE_CREATE,
} from "features/pre-creation/ui/PreCreationView";
import { TagNotesView, VIEW_TYPE_TAG_NOTES } from "features/tag-notes/ui/TagNotesView";
import { AllNotesView, VIEW_TYPE_ALL_NOTES } from "features/all-notes/ui/AllNotesView";
import {
	COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "features/popover/hoverPopoverLinkSpec";
import { CosenseCardLinksSettingTab } from "features/settings/ui/SettingTab";
import { installCCLDebugExposure } from "infrastructure/debug/CCLDebugExposure";
import { registerBenchmarkCommand } from "infrastructure/debug/benchmarkCommandController";
import { registerScrollBenchmarkCommand } from "infrastructure/debug/scrollBenchmarkCommandController";
import { registerCardDragStateCleanup } from "ui/interactions/cardDragState";

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
	if (process.env.NODE_ENV !== "production") {
		installCCLDebugExposure(plugin);
	}

	plugin.addSettingTab(new CosenseCardLinksSettingTab(plugin.app, plugin));
	registerViews(plugin, deps.viewServices);
	registerCommands(plugin, deps);
	if (process.env.NODE_ENV !== "production") {
		registerBenchmarkCommand(plugin, deps.indexingService);
		registerScrollBenchmarkCommand(plugin);
	}
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
