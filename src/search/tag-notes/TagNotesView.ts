import {
	TFile,
	type IconName,
	setIcon,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { normalizeTag } from "indexing/tag-index/tagIndexer";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import TagNotesListHost from "cards/list/ui/TagNotesListHost.svelte";
import type { ListConfig } from "cards/list/ui/types";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import type { TaggedNote } from "indexing/model";
import {
	dataUpdateCollectionHas,
	dataUpdateCollectionSize,
	type DataUpdateContext,
} from "indexing/index-service/IndexEvents";
import { AbstractSvelteListView } from "obsidian-integration/views/abstractSvelteListView";
import { buildEditorLikeFrame } from "obsidian-integration/views/editorLikeFrame";
import { getCardItemKey, type CardItem } from "cards/CardItem";
import {
	createListViewUiState,
	type ListViewUiState,
} from "cards/list/model/listViewUiState";
import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";
import { VIEW_TYPE_TAG_NOTES } from "obsidian-integration/views/viewTypes";
export { openTagNotesView } from "./openTagNotesView";
export { VIEW_TYPE_TAG_NOTES } from "obsidian-integration/views/viewTypes";

export interface TagNotesRefreshDecisionInput {
	readonly tagFeaturesEnabled: boolean;
	readonly tag: string;
	readonly sourcePath: string;
	readonly context?: DataUpdateContext;
	readonly hasCurrentItemPath: (path: string) => boolean;
}

export function shouldRefreshTagNotesForContext({
	tagFeaturesEnabled,
	tag,
	sourcePath,
	context,
	hasCurrentItemPath,
}: TagNotesRefreshDecisionInput): boolean {
	if (!tagFeaturesEnabled || !tag) return false;
	if (!context || context.affectsAll) return true;
	if (dataUpdateCollectionHas(context.affectedTags, tag)) return true;

	const affectedPaths = context.affectedPaths;
	if (dataUpdateCollectionSize(affectedPaths) === 0) return false;
	if (sourcePath && dataUpdateCollectionHas(affectedPaths, sourcePath)) {
		return true;
	}
	for (const path of affectedPaths ?? []) {
		if (hasCurrentItemPath(path)) return true;
	}
	return false;
}

interface TagNotesViewState {
	tag?: unknown;
	sourcePath?: unknown;
	listUiState?: unknown;
}

export class TagNotesView extends AbstractSvelteListView<TaggedNote> {
	private tag = "";
	private sourcePath = "";
	private notes: TaggedNote[] = [];
	private hasLoadedNotes = false;
	private isLoadingNotes = false;
	private loadRequestId = 0;
	private autofocusNextRender = true;
	private infoTextEl: HTMLParagraphElement | undefined = undefined;
	private listUiState: ListViewUiState = createListViewUiState();

	constructor(leaf: WorkspaceLeaf, plugin: PluginHost, viewServices: ViewServices) {
		super(leaf, plugin, viewServices);
	}

	getViewType(): string {
		return VIEW_TYPE_TAG_NOTES;
	}

	getIcon(): IconName {
		return "tag";
	}

	public usesSidebarLinkSurface(): boolean {
		return this.plugin.settings.displayMode === "sidebar-view";
	}

	getDisplayText(): string {
		const text = getMainUiTranslations(this.plugin.settings.language);
		if (!this.plugin.settings.enableTagFeatures) {
			return text.tagFeaturesDisabled;
		}

		if (!this.tag) {
			return text.tagNotes;
		}
		return `#${this.tag}`;
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			tag: this.tag,
			sourcePath: this.sourcePath,
			listUiState: createListViewUiState(this.listUiState),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);

		const { tag, sourcePath, listUiState } = this.extractState(state);
		if (tag !== this.tag || sourcePath !== this.sourcePath) {
			result.history = true;
		}

		const stateChanged = tag !== this.tag || sourcePath !== this.sourcePath;
		this.tag = tag;
		this.sourcePath = sourcePath;
		this.listUiState = listUiState;
		if (stateChanged) {
			this.autofocusNextRender = true;
			this.resetLoadedNotes();
		}
		this.render();
		this.refreshLeafHeader();
		if (stateChanged || !this.hasLoadedNotes) {
			void this.loadNotes({ reset: false });
		}
	}

	private extractState(state: unknown): {
		tag: string;
		sourcePath: string;
		listUiState: ListViewUiState;
	} {
		const candidate = state as TagNotesViewState | null;
		const tag =
			typeof candidate?.tag === "string" ? normalizeTag(candidate.tag) : "";
		const sourcePath =
			typeof candidate?.sourcePath === "string" ? candidate.sourcePath : "";
		return {
			tag,
			sourcePath,
			listUiState: createListViewUiState(candidate?.listUiState),
		};
	}

	private refreshLeafHeader(): void {
		const leaf = this.leaf as WorkspaceLeaf & {
			updateHeader?: () => void;
		};
		leaf.updateHeader?.();
	}

	private isTagFeatureEnabled(): boolean {
		return this.plugin.settings.enableTagFeatures;
	}

	public override refreshFromSettings(): void {
		super.refreshFromSettings();
		this.refreshLeafHeader();
	}

	async onOpen(): Promise<void> {
		this.autofocusNextRender = true;
		await super.onOpen();
		if (this.tag && !this.hasLoadedNotes) {
			void this.loadNotes({ reset: false });
		}
	}

	protected onViewClose(): void {
		this.loadRequestId++;
	}

	protected getItems(): TaggedNote[] {
		return this.notes;
	}

	private resolveSourceFile(): TFile | null {
		if (this.sourcePath) {
			const fromState = resolveFileByPath(this.app.vault, this.sourcePath);
			if (fromState) {
				return fromState;
			}
		}

		const active = this.app.workspace.getActiveFile();
		if (active instanceof TFile) {
			return active;
		}

		return null;
	}

	protected render(): void {
		const autofocus = this.autofocusNextRender;
		const text = getMainUiTranslations(this.plugin.settings.language);

		const container = this.prepareRenderContainer();
		this.infoTextEl = undefined;

		const isEnabled = this.isTagFeatureEnabled();
		const titleText = !isEnabled
			? text.tagFeaturesDisabled
			: this.tag
				? `#${this.tag}`
				: text.tagNotes;
		const notes = this.getItems();
		this.setCurrentItems(notes);

		const frame = buildEditorLikeFrame(container, {
			title: titleText,
			extraWrapperClasses: [
				"cosense-card-links-pre-create",
				"cosense-card-links-tag-notes",
			],
		});
		const titleEl = frame.titleEl;
		titleEl.empty();
		const titleIconEl = titleEl.createSpan({
			cls: "cosense-card-links-tag-notes__title-icon",
		});
		setIcon(titleIconEl, "tag");
		titleEl.createSpan({
			cls: "cosense-card-links-tag-notes__title-text",
			text: titleText,
		});
		const scrollerEl = frame.scrollerEl;
		this.setScrollerElement(scrollerEl);
		const infoEl = frame.infoEl;

		if (!isEnabled) {
			this.infoTextEl = infoEl.createEl("p", {
				text: text.tagFeaturesDisabledMessage,
			}) as HTMLParagraphElement;
			this.autofocusNextRender = false;
			return;
		}

		if (this.tag) {
			if (!this.hasLoadedNotes) {
				this.infoTextEl = infoEl.createEl("p", {
					text: text.loadingNotesWithTag(this.tag),
				}) as HTMLParagraphElement;
				const loadingEl = infoEl.createDiv({
					cls: "cosense-card-links__loading-container",
				});
				loadingEl.createDiv({ cls: "cosense-card-links__loading-spinner" });
				loadingEl.createEl("p", {
					cls: "cosense-card-links__loading-message",
					text: this.isLoadingNotes
						? text.waitingForTagIndex
						: text.preparingTagNotes,
				});
				return;
			}

			this.infoTextEl = infoEl.createEl("p", {}) as HTMLParagraphElement;
			this.updateInfoText();
		} else {
			this.infoTextEl = infoEl.createEl("p", {}) as HTMLParagraphElement;
			this.updateInfoText();
		}

		this.autofocusNextRender = false;
		this.mountTagNotesSection(scrollerEl, autofocus);
	}

	protected shouldRefreshForContext(context?: DataUpdateContext): boolean {
		return shouldRefreshTagNotesForContext({
			tagFeaturesEnabled: this.isTagFeatureEnabled(),
			tag: this.tag,
			sourcePath: this.sourcePath,
			context,
			hasCurrentItemPath: (path) => this.hasCurrentItemKey(path),
		});
	}

	protected refreshItemsForContext(_context?: DataUpdateContext): void {
		if (!this.isTagFeatureEnabled()) {
			this.notes = [];
			this.hasLoadedNotes = true;
			this.isLoadingNotes = false;
			this.applyItemsDiff([], _context);
			this.updateInfoText();
			return;
		}

		const indexingService = this.plugin.indexingService;
		if (!this.tag) {
			return;
		}

		const notes = indexingService.peekNotesWithTag(this.tag, this.sourcePath);

		this.notes = notes;
		this.hasLoadedNotes = true;
		this.isLoadingNotes = false;
		this.applyItemsDiff(notes, _context);
		this.updateInfoText();
	}

	protected isViewReady(): boolean {
		return Boolean(this.scrollerEl && this.hasMountedListHost());
	}

	protected getItemKey(note: TaggedNote): string {
		return note.path;
	}

	protected getItemVersion(note: TaggedNote): number {
		return note.file.stat.mtime;
	}

	protected getListHostComponent() {
		return TagNotesListHost;
	}

	private mountTagNotesSection(parentEl: HTMLElement, autofocus: boolean): void {
		const text = getMainUiTranslations(this.plugin.settings.language);
		const sourceFile = this.resolveSourceFile() ?? ({ path: "" } as TFile);

		const config: ListConfig<CardItem> = {
			title: text.notesWithTag(this.tag),
			paginationMode: "infinite-scroll",
			preserveResultsHeightOnSearch: false,
			getItemKey: getCardItemKey,
			searchPlaceholder: text.searchNoteTitles,
			contentSearchPlaceholder: text.searchNoteContents,
			sectionId: `tag-view-${this.tag}`,
			emptyMessage: text.noNotesFoundWithTag,
		};

		this.mountListSection({
			parentEl,
			sourceFile,
			config,
			autofocus,
			uiState: this.listUiState,
		});
	}

	private resetLoadedNotes(): void {
		this.notes = [];
		this.hasLoadedNotes = false;
		this.isLoadingNotes = false;
		this.setCurrentItems([]);
		this.infoTextEl = undefined;
	}

	private updateInfoText(): void {
		if (!this.infoTextEl) {
			return;
		}

		const text = getMainUiTranslations(this.plugin.settings.language);
		if (this.tag) {
			this.infoTextEl.textContent = text.showingNotesWithTag(
				this.notes.length,
				this.tag,
			);
			return;
		}

		this.infoTextEl.textContent = text.noTagSet;
	}

	private async loadNotes(options: { reset: boolean }): Promise<void> {
		const requestId = ++this.loadRequestId;

		if (options.reset) {
			this.resetLoadedNotes();
		}

		if (!this.isTagFeatureEnabled()) {
			this.hasLoadedNotes = true;
			this.isLoadingNotes = false;
			this.render();
			return;
		}

		if (!this.tag || !this.plugin.indexingService) {
			this.hasLoadedNotes = true;
			this.render();
			return;
		}

		const shouldShowLoading = !this.hasLoadedNotes;
		if (shouldShowLoading) {
			this.isLoadingNotes = true;
			this.render();
		}

		try {
			const notes = await this.plugin.indexingService.getNotesWithTag(
				this.tag,
				this.sourcePath,
			);
			if (requestId !== this.loadRequestId) {
				return;
			}

			this.notes = notes;
			this.hasLoadedNotes = true;
		} catch (error) {
			if (requestId !== this.loadRequestId) {
				return;
			}

			console.error("[TagNotesView] Failed to load tag notes:", error);
			this.notes = [];
			this.hasLoadedNotes = true;
		} finally {
			if (requestId !== this.loadRequestId) {
				return;
			}

			this.isLoadingNotes = false;
			this.render();
		}
	}
}
