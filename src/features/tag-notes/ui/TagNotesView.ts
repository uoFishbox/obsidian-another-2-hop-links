import {
	TFile,
	type IconName,
	type PaneType,
	setIcon,
	type ViewState,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { normalizeTag } from "core/indexing/tag-index/tagIndexer";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import TagNotesListHost from "features/list-view/ui/TagNotesListHost.svelte";
import type { ListConfig } from "features/list-view/ui/types";
import type { PluginHost } from "types/pluginHost";
import type { ViewServices } from "ui/shared/views/viewServices";
import type { TaggedNote } from "types/domain";
import { areTagFeaturesEnabled } from "features/settings/model";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import { AbstractSvelteListView } from "ui/shared/views/abstractSvelteListView";
import { buildEditorLikeFrame } from "ui/shared/views/editorLikeFrame";
import { getViewItemKey, type ViewItem } from "application/presenters/ViewItem";
import { shouldRefreshTagNotesForContext } from "features/tag-notes/ui/tagNotesRefreshDecision";

export const VIEW_TYPE_TAG_NOTES = "cosense-card-links-tag-notes-view";

interface TagNotesViewState {
	tag?: unknown;
	sourcePath?: unknown;
}

export async function openTagNotesView(
	plugin: PluginHost,
	tag: string,
	sourcePath: string,
	newLeaf: PaneType | boolean = false,
): Promise<void> {
	if (!areTagFeaturesEnabled(plugin.settings)) {
		return;
	}

	const normalizedTag = normalizeTag(tag);
	if (!normalizedTag) {
		return;
	}

	const leaf = plugin.app.workspace.getLeaf(newLeaf);
	const viewState: ViewState = {
		type: VIEW_TYPE_TAG_NOTES,
		state: {
			tag: normalizedTag,
			sourcePath,
		},
		active: true,
	};

	await leaf.setViewState(viewState);
	plugin.app.workspace.revealLeaf(leaf);
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

	constructor(leaf: WorkspaceLeaf, plugin: PluginHost, viewServices: ViewServices) {
		super(leaf, plugin, viewServices);
	}

	getViewType(): string {
		return VIEW_TYPE_TAG_NOTES;
	}

	getIcon(): IconName {
		return "tag";
	}

	getDisplayText(): string {
		if (!areTagFeaturesEnabled(this.plugin.settings)) {
			return "Tag features disabled";
		}

		if (!this.tag) {
			return "Tag notes";
		}
		return `#${this.tag}`;
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			tag: this.tag,
			sourcePath: this.sourcePath,
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);

		const { tag, sourcePath } = this.extractState(state);
		if (tag !== this.tag || sourcePath !== this.sourcePath) {
			result.history = true;
		}

		const stateChanged = tag !== this.tag || sourcePath !== this.sourcePath;
		this.tag = tag;
		this.sourcePath = sourcePath;
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
	} {
		const candidate = state as TagNotesViewState | null;
		const tag =
			typeof candidate?.tag === "string" ? normalizeTag(candidate.tag) : "";
		const sourcePath =
			typeof candidate?.sourcePath === "string" ? candidate.sourcePath : "";
		return { tag, sourcePath };
	}

	private refreshLeafHeader(): void {
		const leaf = this.leaf as WorkspaceLeaf & {
			updateHeader?: () => void;
		};
		leaf.updateHeader?.();
	}

	private isTagFeatureEnabled(): boolean {
		return areTagFeaturesEnabled(this.plugin.settings);
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

		const container = this.prepareRenderContainer();
		this.infoTextEl = undefined;

		const isEnabled = this.isTagFeatureEnabled();
		const titleText = !isEnabled
			? "Tag features disabled"
			: this.tag
				? `#${this.tag}`
				: "Tag notes";
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
				text: "Tag features are disabled.",
			}) as HTMLParagraphElement;
			this.autofocusNextRender = false;
			return;
		}

		if (this.tag) {
			if (!this.hasLoadedNotes) {
				this.infoTextEl = infoEl.createEl("p", {
					text: `Loading notes tagged with #${this.tag}.`,
				}) as HTMLParagraphElement;
				const loadingEl = infoEl.createDiv({
					cls: "cosense-card-links__loading-container",
				});
				loadingEl.createDiv({ cls: "cosense-card-links__loading-spinner" });
				loadingEl.createEl("p", {
					cls: "cosense-card-links__loading-message",
					text: this.isLoadingNotes
						? "Waiting for the tag index to finish building."
						: "Preparing tag notes.",
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
		const sourceFile = this.resolveSourceFile() ?? ({ path: "" } as TFile);

		const config: ListConfig<ViewItem> = {
			title: `Notes with #${this.tag}`,
			paginationMode: "infinite-scroll",
			preserveResultsHeightOnSearch: false,
			getItemKey: getViewItemKey,
			sectionId: `tag-view-${this.tag}`,
			emptyMessage: "No notes found with this tag.",
		};

		this.mountListSection({
			parentEl,
			sourceFile,
			config,
			autofocus,
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

		if (this.tag) {
			this.infoTextEl.textContent = `Showing ${this.notes.length} notes tagged with #${this.tag}.`;
			return;
		}

		this.infoTextEl.textContent = "No tag is set for this temporary view.";
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
