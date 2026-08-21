import { ItemView, TFile, type IconName, type WorkspaceLeaf } from "obsidian";
import { mount } from "svelte";
import type { TwoHopApplicationStore } from "features/two-hop/application/TwoHopApplicationStore.svelte";
import type { PluginHost } from "types/pluginHost";
import type { ViewServices } from "ui/shared/views/viewServices";
import {
	createDefaultApplicationStore,
	createLinkContextForView,
} from "ui/shared/views/viewFactories";
import {
	cleanupSvelteAndStore,
	type SvelteComponentInstance,
} from "ui/shared/views/svelteLifecycle";
import AllNotesPage from "./AllNotesPage.svelte";

export const VIEW_TYPE_ALL_NOTES = "cosense-card-links-all-notes-view";

export class AllNotesView extends ItemView {
	private component: SvelteComponentInstance | undefined = undefined;
	private applicationStore: TwoHopApplicationStore | undefined = undefined;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: PluginHost,
		private readonly viewServices: ViewServices,
	) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return VIEW_TYPE_ALL_NOTES;
	}

	getDisplayText(): string {
		return "All notes";
	}

	getIcon(): IconName {
		return "files";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	public refreshFromSettings(): void {
		this.render();
	}

	private resolveSourceFile(): TFile {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile) {
			return activeFile;
		}

		const firstMarkdownFile = this.app.vault.getMarkdownFiles()[0];
		if (firstMarkdownFile instanceof TFile) {
			return firstMarkdownFile;
		}

		return { path: "" } as TFile;
	}

	private render(): void {
		[this.component, this.applicationStore] = cleanupSvelteAndStore(
			this.component,
			this.applicationStore,
		);

		this.contentEl.empty();

		const applicationStore = createDefaultApplicationStore(
			this.viewServices,
			this.plugin.settings,
		);
		const linkContext = createLinkContextForView(
			this.viewServices,
			this.resolveSourceFile(),
			this.plugin.settings,
		);

		this.applicationStore = applicationStore;
		this.component = mount(AllNotesPage, {
			target: this.contentEl,
			props: {
				app: this.plugin.app,
				settings: this.plugin.settings,
				sortService: this.plugin.sortService,
				linkContext,
				applicationStore: applicationStore.uiState,
				previewRuntime: this.viewServices.previewRuntime,
			},
		}) as SvelteComponentInstance;
	}

	async onClose(): Promise<void> {
		[this.component, this.applicationStore] = cleanupSvelteAndStore(
			this.component,
			this.applicationStore,
		);
	}
}
