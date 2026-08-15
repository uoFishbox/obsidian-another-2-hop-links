import type { App, TFile } from "obsidian";
import { mount } from "svelte";
import type { PluginSettings } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { LinkContext } from "ui/context/linkContext";
import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";
import type { SvelteComponentInstance } from "ui/shared/views/svelteLifecycle";
import TwoHopLinksPage from "./TwoHopLinksPage.svelte";
import type { TwoHopLinksRootUiState } from "./twoHopLinksRootUiState";

export interface MountTwoHopLinksRootViewOptions {
	target: Element;
	app: App;
	file: TFile;
	settings: PluginSettings;
	applicationStore: ApplicationStore;
	linkContext: LinkContext;
	previewRuntime: PreviewRuntime;
	lazyLoaderCache: Set<string>;
	isSidebar?: boolean;
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
		app,
		file,
		settings,
		applicationStore,
		linkContext,
		previewRuntime,
		lazyLoaderCache,
		isSidebar = false,
		updateSetting,
		uiState,
	} = options;
	applicationStore.setSettings(settings);

	const component = mount(TwoHopLinksPage, {
		target,
		props: {
			file,
			linkContext,
			applicationStore,
			app,
			previewRuntime,
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
