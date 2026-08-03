import type { TFile } from "obsidian";
import { mount } from "svelte";
import type { PluginHostUi } from "types/pluginHostUi";
import type { PluginSettings } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	createDefaultApplicationStore,
	createLinkContextForView,
} from "ui/shared/views/viewFactories";
import type { SvelteComponentInstance } from "ui/shared/views/svelteLifecycle";
import TwoHopLinksPage from "./TwoHopLinksPage.svelte";
import type { TwoHopLinksRootUiState } from "./twoHopLinksRootUiState";

export interface MountTwoHopLinksRootViewOptions {
	target: Element;
	plugin: PluginHostUi;
	file: TFile;
	settings: PluginSettings;
	lazyLoaderCache: Set<string>;
	isSidebar?: boolean;
	wrapForView?: boolean;
	getApplicationStore?: () => ApplicationStore;
	updateSetting?: <K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
	) => Promise<void>;
	uiState?: TwoHopLinksRootUiState;
}

export interface MountedTwoHopLinksRootView {
	component: SvelteComponentInstance;
	applicationStore: ApplicationStore;
}

/** Mounts the Two Hop page and starts loading its source file. */
export function mountTwoHopLinksRootView(
	options: MountTwoHopLinksRootViewOptions,
): MountedTwoHopLinksRootView {
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
			previewRuntime: plugin.getPreviewRuntime?.(),
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
