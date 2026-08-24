import { ItemView, TFile, type IconName, type WorkspaceLeaf } from "obsidian";
import { mount } from "svelte";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import {
	createDefaultCardCollectionState,
	createLinkContextForView,
} from "obsidian-integration/views/viewFactories";
import {
	cleanupSvelteAndStore,
	type SvelteComponentInstance,
} from "obsidian-integration/views/svelteLifecycle";
import AllNotesPage from "./AllNotesPage.svelte";

export const VIEW_TYPE_ALL_NOTES = "cosense-card-links-all-notes-view";

export class AllNotesView extends ItemView {
	private component: SvelteComponentInstance | undefined = undefined;
	private cardCollectionState: CardCollectionState | undefined = undefined;

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
		[this.component, this.cardCollectionState] = cleanupSvelteAndStore(
			this.component,
			this.cardCollectionState,
		);

		this.contentEl.empty();

		const cardCollectionState = createDefaultCardCollectionState(
			this.viewServices,
			this.plugin.settings,
		);
		const linkContext = createLinkContextForView(
			this.viewServices,
			this.resolveSourceFile(),
			this.plugin.settings,
		);

		this.cardCollectionState = cardCollectionState;
		this.component = mount(AllNotesPage, {
			target: this.contentEl,
			props: {
				app: this.plugin.app,
				settings: this.plugin.settings,
				sortService: this.plugin.sortService,
				linkContext,
				applicationStore: cardCollectionState,
				previewRuntime: this.viewServices.previewRuntime,
			},
		}) as SvelteComponentInstance;
	}

	async onClose(): Promise<void> {
		[this.component, this.cardCollectionState] = cleanupSvelteAndStore(
			this.component,
			this.cardCollectionState,
		);
	}
}
