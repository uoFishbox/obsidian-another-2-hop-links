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
import { markdownPostProcessor } from "obsidian-integration/markdown/markdownHandlers";
import { downloadAsFile, exportToClipboard } from "two-hop/export/exportService";
import {
	TWO_HOP_LINKS_VIEW_TYPE,
	VIEW_TYPE_ALL_NOTES,
	VIEW_TYPE_PRE_CREATE,
	VIEW_TYPE_TAG_NOTES,
} from "obsidian-integration/views/viewTypes";
import {
	COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
	COSENSE_CARD_LINKS_HOVER_SOURCE_ID,
} from "hover-popover/hoverPopoverLinkSpec";
import { CosenseCardLinksSettingTab } from "settings/ui/SettingTab";
import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";

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
	plugin.addSettingTab(new CosenseCardLinksSettingTab(plugin.app, plugin));
	registerViews(plugin, deps.viewServices);
	registerCommands(plugin, deps);
	registerEditorExtensions(plugin, deps.linkStatusService);
	registerMarkdownProcessors(plugin, deps);
	registerFileMenu(plugin);
}

function registerViews(plugin: PluginHost, viewServices: ViewServices): void {
	plugin.registerView(TWO_HOP_LINKS_VIEW_TYPE, (leaf) => {
		const { TwoHopLinksView } =
			require("two-hop/ui/TwoHopLinksView") as typeof import("two-hop/ui/TwoHopLinksView");
		return new TwoHopLinksView(leaf, plugin, viewServices);
	});
	plugin.registerView(VIEW_TYPE_PRE_CREATE, (leaf) => {
		const { PreCreationView } =
			require("two-hop/pre-creation/PreCreationView") as typeof import("two-hop/pre-creation/PreCreationView");
		return new PreCreationView(leaf, plugin, viewServices);
	});
	plugin.registerView(VIEW_TYPE_TAG_NOTES, (leaf) => {
		const { TagNotesView } =
			require("search/tag-notes/TagNotesView") as typeof import("search/tag-notes/TagNotesView");
		return new TagNotesView(leaf, plugin, viewServices);
	});
	plugin.registerView(VIEW_TYPE_ALL_NOTES, (leaf) => {
		const { AllNotesView } =
			require("search/all-notes/AllNotesView") as typeof import("search/all-notes/AllNotesView");
		return new AllNotesView(leaf, plugin, viewServices);
	});
	plugin.registerHoverLinkSource(COSENSE_CARD_LINKS_HOVER_SOURCE_ID, {
		display: COSENSE_CARD_LINKS_HOVER_SOURCE_DISPLAY,
		defaultMod: true,
	});
}

function registerCommands(plugin: PluginHost, deps: RegisterPluginSurfacesDeps): void {
	const text = getMainUiTranslations(plugin.settings.language);
	plugin.addCommand({
		id: "toggle-scroll-to-two-hop-links",
		name: text.scrollToTwoHopLinks,
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
		name: text.activateKeyboardNavigation,
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
			const text = getMainUiTranslations(plugin.settings.language);

			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(text.copyTwoHopLinks)
					.setIcon("copy")
					.setSection("action")
					.onClick(async () => {
						const result = await plugin.getTwoHopLinkResult(file);
						await exportToClipboard(
							plugin.app,
							result,
							plugin.settings.language,
						);
					});
			});

			menu.addItem((item) => {
				item.setTitle(text.exportTwoHopLinks)
					.setIcon("download")
					.setSection("action")
					.onClick(async () => {
						const result = await plugin.getTwoHopLinkResult(file);
						await downloadAsFile(
							plugin.app,
							result,
							plugin.settings.language,
						);
					});
			});
		}),
	);
}
