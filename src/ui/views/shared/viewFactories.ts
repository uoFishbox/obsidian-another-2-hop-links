import type { PluginHostUi } from "types/pluginHostUi";
import type { TFile } from "obsidian";
import { createViewLinkContext } from "ui/pages/utils";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { PluginSettings } from "types/settings";
import { areTagFeaturesEnabled } from "types/settings";
import { mount } from "svelte";
import TwoHopLinksPage from "ui/pages/TwoHopLinksPage.svelte";
import type { SvelteComponentInstance } from "ui/views/shared/svelteLifecycle";
import type { TwoHopLinksRootUiState } from "ui/views/shared/twoHopLinksRootUiState";

export function createDefaultApplicationStore(
	plugin: PluginHostUi,
	settings: PluginSettings = plugin.settings,
): ApplicationStore {
	const displayDataBuilder = plugin.createDisplayDataBuilder();
	return plugin.createApplicationStore(
		settings,
		displayDataBuilder,
		(file: TFile, onProgress) =>
			plugin.getTwoHopLinkResult(file, onProgress, {
				includeTaggedNotes:
					areTagFeaturesEnabled(plugin.settings) &&
					plugin.settings.showTagsSection,
			}),
	);
}

export function createLinkContextForView(
	plugin: PluginHostUi,
	sourceFile: TFile,
	settings: PluginSettings = plugin.settings,
	options?: { wrapForView?: boolean; closeView?: () => void },
): LinkContext {
	const linkContextFactory = plugin.getLinkContextFactory();
	const baseLinkContext = linkContextFactory(sourceFile, settings);
	const wrapForView = options?.wrapForView ?? true;
	if (!wrapForView) {
		return baseLinkContext;
	}
	return createViewLinkContext(baseLinkContext, options?.closeView ?? (() => {}));
}

interface MountTwoHopLinksRootViewOptions {
	target: Element;
	plugin: PluginHostUi;
	file: TFile;
	settings: PluginSettings;
	lazyLoaderCache: Set<string>;
	isSidebar?: boolean;
	wrapForView?: boolean;
	getApplicationStore?: () => ApplicationStore;
	updateSetting?: <K extends string>(key: K, value: unknown) => Promise<void>;
	uiState?: TwoHopLinksRootUiState;
}

export function mountTwoHopLinksRootView(options: MountTwoHopLinksRootViewOptions): {
	component: SvelteComponentInstance;
	applicationStore: ApplicationStore;
} {
	const {
		target,
		plugin,
		file,
		settings,
		lazyLoaderCache,
		isSidebar = false,
		wrapForView = true,
		getApplicationStore,
		updateSetting,
		uiState,
	} = options;
	const applicationStore =
		getApplicationStore?.() ?? createDefaultApplicationStore(plugin, settings);
	applicationStore.setSettings(settings);
	const linkContext = createLinkContextForView(plugin, file, settings, {
		wrapForView,
	});

	const component = mount(TwoHopLinksPage, {
		target,
		props: {
			file,
			linkContext,
			applicationStore,
			app: plugin.app,
			lazyLoaderCache,
			isSidebar,
			updateSetting,
			uiState,
		},
	}) as SvelteComponentInstance;

	applicationStore.load(file);

	return {
		component,
		applicationStore,
	};
}
