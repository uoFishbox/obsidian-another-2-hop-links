import {
	Notice,
	TFile,
	TFolder,
	getLinkpath,
	type IconName,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { resolveExpectedPath } from "obsidian-integration/files/resolveExpectedPath";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import {
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "indexing/link-resolution/linkResolution";
import TagNotesListHost from "cards/list/ui/TagNotesListHost.svelte";
import type { ListConfig } from "cards/list/ui/types";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import type { IndexedLink } from "indexing/model";
import {
	dataUpdateCollectionSize,
	type DataUpdateContext,
} from "indexing/index-service/IndexEvents";
import { AbstractSvelteListView } from "obsidian-integration/views/abstractSvelteListView";
import { buildEditorLikeFrame } from "obsidian-integration/views/editorLikeFrame";
import { getCardItemKey, type CardItem } from "cards/CardItem";
import { materializePreCreationFile } from "./preCreationFileWorkflow";
import { isPlainEnterAtContentEnd } from "shared/ui/dom/contentEditableCaret";
import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";
import { VIEW_TYPE_PRE_CREATE } from "obsidian-integration/views/viewTypes";
import {
	PRE_CREATION_EPHEMERAL_STATE_KEY,
	getPersistedPreCreationBootstrapState,
	setPersistedPreCreationBootstrapState,
	takePendingPreCreationBootstrapState,
} from "./preCreationBootstrapState";

export { VIEW_TYPE_PRE_CREATE } from "obsidian-integration/views/viewTypes";
export {
	PRE_CREATION_EPHEMERAL_STATE_KEY,
	hasAnyPreCreationBootstrapState,
	setPendingPreCreationBootstrapState,
	setPersistedPreCreationBootstrapState,
} from "./preCreationBootstrapState";

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

function dedupeBySourceFile(
	links: readonly Readonly<IndexedLink>[],
	excludePath?: string,
): IndexedLink[] {
	const seen = new Set<string>();
	const result: IndexedLink[] = [];
	for (const link of links) {
		const sourcePath = link.sourceFile.path;
		if (sourcePath === excludePath || seen.has(sourcePath)) continue;
		seen.add(sourcePath);
		result.push(link);
	}
	return result;
}

type PreCreationState = {
	linktext?: unknown;
	sourcePath?: unknown;
	expectedPath?: unknown;
	creationPath?: unknown;
};

export class PreCreationView extends AbstractSvelteListView<IndexedLink> {
	private linktext = "";
	private sourcePath = "";
	private expectedPath = "";
	private creationPath = "";
	private inlineTitleEl: HTMLDivElement | undefined = undefined;
	private createButtonEl: HTMLButtonElement | undefined = undefined;
	private isCreating = false;
	private titleCancelled = false;
	private originalTitleText = "";

	constructor(leaf: WorkspaceLeaf, plugin: PluginHost, viewServices: ViewServices) {
		super(leaf, plugin, viewServices);
		this.hydrateFromPersistedBootstrapState();
		this.hydrateFromPendingBootstrapState();
		this.hydrateFromEphemeralState();
	}

	getViewType(): string {
		return VIEW_TYPE_PRE_CREATE;
	}

	getIcon(): IconName {
		return "file-plus-2";
	}

	public usesSidebarLinkSurface(): boolean {
		return this.plugin.settings.displayMode === "sidebar-view";
	}

	getDisplayText(): string {
		const expectedPath = this.getDisplayExpectedPath();
		if (!expectedPath) {
			return getMainUiTranslations(this.plugin.settings.language).createFile;
		}
		// Display the full path (remove the .md extension)
		const displayPath = expectedPath.endsWith(".md")
			? expectedPath.slice(0, -3)
			: expectedPath;
		return `${displayPath}`;
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			linktext: this.linktext,
			sourcePath: this.sourcePath,
			expectedPath: this.expectedPath,
			creationPath: this.creationPath,
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);

		const { linktext, sourcePath, expectedPath, creationPath } =
			this.extractState(state);
		if (linktext !== this.linktext || sourcePath !== this.sourcePath) {
			result.history = true;
		}

		this.linktext = linktext;
		this.sourcePath = sourcePath;
		this.expectedPath = expectedPath || this.computeExpectedPath();
		this.creationPath = creationPath || this.creationPath || this.expectedPath;
		this.persistCurrentBootstrapState();
		this.syncToEphemeralState();
		this.render();
		this.refreshLeafHeader();
	}

	protected onViewClose(): void {
		this.inlineTitleEl = undefined;
		this.createButtonEl = undefined;
	}

	private extractState(state: unknown): {
		linktext: string;
		sourcePath: string;
		expectedPath: string;
		creationPath: string;
	} {
		const candidate = state as PreCreationState | null;
		const linktext =
			typeof candidate?.linktext === "string" ? candidate.linktext : "";
		const sourcePath =
			typeof candidate?.sourcePath === "string" ? candidate.sourcePath : "";
		const expectedPath =
			typeof candidate?.expectedPath === "string" ? candidate.expectedPath : "";
		const creationPath =
			typeof candidate?.creationPath === "string" ? candidate.creationPath : "";
		return { linktext, sourcePath, expectedPath, creationPath };
	}

	private computeExpectedPath(): string {
		if (!this.linktext) {
			return "";
		}
		return resolveExpectedPath(this.app, this.linktext, this.sourcePath);
	}

	private getDisplayExpectedPath(): string {
		if (this.expectedPath) {
			return this.expectedPath;
		}

		const ephemeral = this.readEphemeralState();
		if (ephemeral.expectedPath) {
			return ephemeral.expectedPath;
		}

		const linktext = this.linktext || ephemeral.linktext;
		const sourcePath = this.sourcePath || ephemeral.sourcePath;
		if (!linktext) {
			return "";
		}
		return resolveExpectedPath(this.app, linktext, sourcePath);
	}

	private refreshLeafHeader(): void {
		// Ensure the title is re-evaluated after View.setState
		const leaf = this.leaf as WorkspaceLeaf & {
			updateHeader?: () => void;
		};
		leaf.updateHeader?.();
	}

	/**
	 * Apply inline-title edits to linktext.
	 * If newName contains a path separator, treat it as a complete path.
	 * Otherwise, replace only the last segment of the existing path.
	 */
	private updateLinktextFromTitle(newName: string): void {
		if (!newName) {
			return;
		}
		// If newName contains a path separator, treat it as a complete path
		if (newName.includes("/")) {
			this.linktext = newName;
		} else {
			// If there is no path separator, replace only the last segment of the existing path
			const slashIdx = this.linktext.lastIndexOf("/");
			if (slashIdx !== -1) {
				// "path/to/OldName" → "path/to/NewName"
				this.linktext = this.linktext.slice(0, slashIdx + 1) + newName;
			} else {
				this.linktext = newName;
			}
		}
		this.expectedPath = this.computeExpectedPath();
		this.persistCurrentBootstrapState();
		this.syncToEphemeralState();
		this.refreshLeafHeader();
	}

	private hydrateFromEphemeralState(): void {
		const ephemeral = this.readEphemeralState();
		if (!this.linktext && ephemeral.linktext) {
			this.linktext = ephemeral.linktext;
		}
		if (!this.sourcePath && ephemeral.sourcePath) {
			this.sourcePath = ephemeral.sourcePath;
		}
		if (!this.expectedPath && ephemeral.expectedPath) {
			this.expectedPath = ephemeral.expectedPath;
		}
		if (!this.creationPath && ephemeral.creationPath) {
			this.creationPath = ephemeral.creationPath;
		}
	}

	private hydrateFromPersistedBootstrapState(): void {
		const persisted = getPersistedPreCreationBootstrapState(this.leaf);
		if (!persisted) {
			return;
		}
		if (!this.linktext && persisted.linktext) {
			this.linktext = persisted.linktext;
		}
		if (!this.sourcePath && persisted.sourcePath) {
			this.sourcePath = persisted.sourcePath;
		}
		if (!this.expectedPath && persisted.expectedPath) {
			this.expectedPath = persisted.expectedPath;
		}
		if (!this.creationPath && persisted.creationPath) {
			this.creationPath = persisted.creationPath;
		}
	}

	private hydrateFromPendingBootstrapState(): void {
		const pending = takePendingPreCreationBootstrapState(this.leaf);
		if (!pending) {
			return;
		}
		this.linktext = pending.linktext;
		this.sourcePath = pending.sourcePath;
		this.expectedPath = pending.expectedPath;
		this.creationPath = pending.creationPath;
	}

	private readEphemeralState(): {
		linktext: string;
		sourcePath: string;
		expectedPath: string;
		creationPath: string;
	} {
		const eState = this.leaf.getEphemeralState();
		if (!eState || typeof eState !== "object") {
			return { linktext: "", sourcePath: "", expectedPath: "", creationPath: "" };
		}
		const raw = (eState as Record<string, unknown>)[
			PRE_CREATION_EPHEMERAL_STATE_KEY
		];
		if (!raw || typeof raw !== "object") {
			return { linktext: "", sourcePath: "", expectedPath: "", creationPath: "" };
		}
		const candidate = raw as Record<string, unknown>;
		const linktext =
			typeof candidate.linktext === "string" ? candidate.linktext : "";
		const sourcePath =
			typeof candidate.sourcePath === "string" ? candidate.sourcePath : "";
		const expectedPath =
			typeof candidate.expectedPath === "string" ? candidate.expectedPath : "";
		const creationPath =
			typeof candidate.creationPath === "string" ? candidate.creationPath : "";
		return { linktext, sourcePath, expectedPath, creationPath };
	}

	private syncToEphemeralState(): void {
		const eState = this.leaf.getEphemeralState();
		const next =
			eState && typeof eState === "object"
				? { ...(eState as Record<string, unknown>) }
				: {};
		next[PRE_CREATION_EPHEMERAL_STATE_KEY] = {
			linktext: this.linktext,
			sourcePath: this.sourcePath,
			expectedPath: this.expectedPath,
			creationPath: this.creationPath,
		};
		this.leaf.setEphemeralState(next);
	}

	private persistCurrentBootstrapState(): void {
		setPersistedPreCreationBootstrapState(this.leaf, {
			linktext: this.linktext,
			sourcePath: this.sourcePath,
			expectedPath: this.expectedPath,
			creationPath: this.creationPath,
		});
	}

	protected getItems(): IndexedLink[] {
		if (!this.linktext || !this.plugin.indexingService) {
			return [];
		}
		const rawLinkPath = getLinkpath(this.linktext);
		const lookupPath = normalizeLinkToMarkdownPath(rawLinkPath);
		const backlinks = this.plugin.indexingService.getBacklinksForLink(lookupPath);
		return dedupeBySourceFile(backlinks);
	}

	private getCurrentLookupKey(): string {
		if (!this.linktext) {
			return "";
		}
		const rawLinkPath = getLinkpath(this.linktext);
		const lookupPath = normalizeLinkToMarkdownPath(rawLinkPath);
		return toCaseInsensitiveLookupKey(lookupPath);
	}

	protected shouldRefreshForContext(context?: DataUpdateContext): boolean {
		if (!context || context.affectsAll) {
			return true;
		}

		const affectedPaths = context.affectedPaths;
		if (affectedPaths && dataUpdateCollectionSize(affectedPaths) > 0) {
			for (const path of affectedPaths) {
				if (this.hasCurrentItemKey(path)) {
					return true;
				}
			}
		}

		const affectedLookupKeys = context.affectedLookupKeys;
		if (dataUpdateCollectionSize(affectedLookupKeys) === 0) {
			return true;
		}

		const currentLookupKey = this.getCurrentLookupKey();
		if (!currentLookupKey) {
			return false;
		}
		for (const lookupKey of affectedLookupKeys ?? []) {
			if (lookupKey === currentLookupKey) {
				return true;
			}
		}
		return false;
	}

	/** Resolve the source file for LinkContext. Return null if it cannot be found. */
	private resolveSourceFile(): TFile | null {
		if (!this.sourcePath) {
			return null;
		}
		return resolveFileByPath(this.app.vault, this.sourcePath);
	}

	protected render(): void {
		const container = this.prepareRenderContainer();
		const text = getMainUiTranslations(this.plugin.settings.language);

		// Display and edit only the last segment of the path (the file name)
		const titleText = this.expectedPath
			? (() => {
					const path = this.expectedPath.endsWith(".md")
						? this.expectedPath.slice(0, -3)
						: this.expectedPath;
					// Extract only the last segment of the path
					return getPathBasename(path);
				})()
			: text.unresolvedLink;

		const frame = buildEditorLikeFrame(container, {
			title: titleText,
			extraWrapperClasses: ["cosense-card-links-pre-create"],
		});
		const scrollerEl = frame.scrollerEl;
		this.setScrollerElement(scrollerEl);

		// Editable title that mimics Obsidian's inline-title
		this.inlineTitleEl = frame.titleEl;
		this.inlineTitleEl.contentEditable = "true";
		this.inlineTitleEl.spellcheck = false;
		this.inlineTitleEl.setAttribute("autocapitalize", "on");
		this.inlineTitleEl.tabIndex = -1;
		this.inlineTitleEl.setAttribute("enterkeyhint", "done");
		this.inlineTitleEl.setAttribute("placeholder", text.untitled);
		this.inlineTitleEl.textContent = titleText;

		this.originalTitleText = titleText;
		this.titleCancelled = false;

		// During editing: update linktext / expectedPath to synchronize button state
		this.inlineTitleEl.addEventListener("input", () => {
			const newName = this.inlineTitleEl?.textContent?.trim() ?? "";
			this.updateLinktextFromTitle(newName);
			if (this.createButtonEl) {
				this.createButtonEl.disabled = !this.expectedPath || this.isCreating;
			}
		});

		this.inlineTitleEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				if (!this.plugin.settings.experimentalCosenseTitleEditing) {
					this.inlineTitleEl?.blur();
					return;
				}
				if (
					this.inlineTitleEl &&
					isPlainEnterAtContentEnd(e, this.inlineTitleEl)
				) {
					void this.handleCreateAndOpen();
				}
			} else if (e.key === "Escape") {
				this.titleCancelled = true;
				if (this.inlineTitleEl) {
					this.inlineTitleEl.textContent = titleText;
				}
				this.inlineTitleEl?.blur();
			}
		});

		this.inlineTitleEl.addEventListener("blur", () => {
			if (this.titleCancelled) {
				this.titleCancelled = false;
				return;
			}
			const currentTitle = this.inlineTitleEl?.textContent?.trim() ?? "";
			if (currentTitle === this.originalTitleText) {
				return;
			}
			// Do nothing if expectedPath is empty or creation is in progress
			if (!this.expectedPath || this.isCreating) {
				return;
			}
			// Create the file
			void this.handleCreateAndOpen();
		});

		// Description + actions (placed where metadata-container would be)
		const infoEl = frame.infoEl;

		if (this.expectedPath) {
		} else {
			infoEl.createEl("p", {
				text: text.noTargetPath,
			});
		}

		const actionsEl = infoEl.createDiv({
			cls: "cosense-card-links-pre-create__actions",
		});

		this.createButtonEl = actionsEl.createEl("button", {
			cls: "mod-cta",
			text: text.createFile,
		});
		this.createButtonEl.disabled = !this.expectedPath || this.isCreating;
		this.createButtonEl.addEventListener("click", () => {
			void this.handleCreateAndOpen();
		});
		this.createButtonEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this.handleCreateAndOpen();
			}
		});
		this.createButtonEl.focus();

		// Place the backlinks section directly under .cm-scroller (after .cm-sizer), as in the normal editor
		this.mountBacklinksSection(scrollerEl);
	}

	private mountBacklinksSection(parentEl: HTMLElement): void {
		const text = getMainUiTranslations(this.plugin.settings.language);
		const backlinks = this.getItems();
		this.setCurrentItems(backlinks);

		// Use a dummy with path: "" if the source file cannot be resolved
		const sourceFile = this.resolveSourceFile() ?? ({ path: "" } as TFile);

		const config: ListConfig<CardItem> = {
			title: text.linksTo(this.linktext),
			showSectionHeader: true,
			sectionHeaderTitle: this.plugin.settings.useMergedLinksSection
				? text.links
				: text.backlinks,
			paginationMode: "infinite-scroll",
			preserveResultsHeightOnSearch: false,
			getItemKey: getCardItemKey,
			// The unresolved origin has no outgoing links: every backlink scores 1.
			allowRelevanceSort: true,
			searchPlaceholder: text.searchNoteTitles,
			contentSearchPlaceholder: text.searchNoteContents,
			sectionId: "pre-create-backlinks",
			emptyMessage: text.noUnresolvedBacklinks,
		};

		this.mountListSection({
			parentEl,
			sourceFile,
			config,
			autofocus: false,
		});
	}

	protected getItemKey(backlink: IndexedLink): string {
		return backlink.sourceFile.path;
	}

	protected getItemVersion(backlink: IndexedLink): number {
		return backlink.sourceFile.stat.mtime;
	}

	protected getListHostComponent() {
		return TagNotesListHost;
	}

	private async handleCreateAndOpen(): Promise<void> {
		if (!this.expectedPath || this.isCreating) {
			return;
		}

		this.isCreating = true;
		if (this.createButtonEl) {
			this.createButtonEl.disabled = true;
		}

		try {
			const creationPath = this.creationPath || this.expectedPath;
			await this.ensureParentFolder(creationPath);
			if (creationPath !== this.expectedPath) {
				await this.ensureParentFolder(this.expectedPath);
			}

			const file = await materializePreCreationFile({
				creationPath,
				finalPath: this.expectedPath,
				createFile: (path) => this.app.vault.create(path, ""),
				renameFile: (createdFile, newPath) =>
					this.app.fileManager.renameFile(createdFile, newPath),
				waitForIndexIdle: () => this.plugin.indexingService.awaitIdle(),
			});
			// Open the file in the current leaf
			await this.leaf.openFile(file, { active: true });
		} catch (error) {
			console.error(
				"[Cosense card links] Failed to create unresolved file:",
				error,
			);
			new Notice(
				getMainUiTranslations(this.plugin.settings.language).createFileFailure,
			);
		} finally {
			this.isCreating = false;
			if (this.leaf.view === this) {
				this.render();
			}
		}
	}

	private async ensureParentFolder(path: string): Promise<void> {
		const lastSlashIndex = path.lastIndexOf("/");
		if (lastSlashIndex === -1) {
			return;
		}

		const dirPath = path.slice(0, lastSlashIndex);
		const folder = this.app.vault.getAbstractFileByPath(dirPath);
		if (!(folder instanceof TFolder)) {
			await this.app.vault.createFolder(dirPath);
		}
	}
}
