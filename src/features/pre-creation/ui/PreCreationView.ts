import {
	Notice,
	TFile,
	TFolder,
	getLinkpath,
	type IconName,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { resolveExpectedPath } from "shared/obsidian/resolveExpectedPath";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import { getLeafId } from "infrastructure/workspace/workspaceLeafIdentity";
import {
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "core/indexing/link-resolution/linkResolution";
import { dedupeBySourceFile } from "core/indexing/backlink-builder/backlinkIndexer";
import TagNotesListHost from "ui/components/lists/TagNotesListHost.svelte";
import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
import type { ListConfig } from "ui/components/lists/types";
import type { PluginHostUi } from "types/pluginHostUi";
import type { TwoHopIndexedLink } from "types/domain";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import { AbstractSvelteListView } from "ui/shared/views/abstractSvelteListView";
import { buildEditorLikeFrame } from "ui/shared/views/editorLikeFrame";
import { getViewItemKey, type ViewItem } from "application/presenters";

export const VIEW_TYPE_PRE_CREATE = "cosense-card-links-pre-create-view";
export const PRE_CREATION_EPHEMERAL_STATE_KEY = "cosense-card-links-pre-create";

type PreCreationBootstrapState = {
	linktext: string;
	sourcePath: string;
	expectedPath: string;
};

const pendingBootstrapStateByLeafId = new Map<string, PreCreationBootstrapState>();
const persistedBootstrapStateByLeafId = new Map<string, PreCreationBootstrapState>();

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

export function hasAnyPreCreationBootstrapState(): boolean {
	return (
		pendingBootstrapStateByLeafId.size > 0 ||
		persistedBootstrapStateByLeafId.size > 0
	);
}

export function setPendingPreCreationBootstrapState(
	leaf: WorkspaceLeaf,
	state: PreCreationBootstrapState,
): void {
	const leafId = getLeafId(leaf);
	if (!leafId) {
		return;
	}
	pendingBootstrapStateByLeafId.set(leafId, state);
}

export function setPersistedPreCreationBootstrapState(
	leaf: WorkspaceLeaf,
	state: PreCreationBootstrapState,
): void {
	const leafId = getLeafId(leaf);
	if (!leafId) {
		return;
	}
	persistedBootstrapStateByLeafId.set(leafId, state);
}

type PreCreationState = {
	linktext?: unknown;
	sourcePath?: unknown;
	expectedPath?: unknown;
};

export class PreCreationView extends AbstractSvelteListView<TwoHopIndexedLink> {
	private linktext = "";
	private sourcePath = "";
	private expectedPath = "";
	private inlineTitleEl: HTMLDivElement | undefined = undefined;
	private createButtonEl: HTMLButtonElement | undefined = undefined;
	private isCreating = false;
	private titleCancelled = false;
	private originalTitleText = "";

	constructor(leaf: WorkspaceLeaf, plugin: PluginHostUi) {
		super(leaf, plugin);
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

	getDisplayText(): string {
		const expectedPath = this.getDisplayExpectedPath();
		if (!expectedPath) {
			return "Create unresolved file";
		}
		// フルパスを表示（.md 拡張子は除去）
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
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);

		const { linktext, sourcePath, expectedPath } = this.extractState(state);
		if (linktext !== this.linktext || sourcePath !== this.sourcePath) {
			result.history = true;
		}

		this.linktext = linktext;
		this.sourcePath = sourcePath;
		this.expectedPath = expectedPath || this.computeExpectedPath();
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
	} {
		const candidate = state as PreCreationState | null;
		const linktext =
			typeof candidate?.linktext === "string" ? candidate.linktext : "";
		const sourcePath =
			typeof candidate?.sourcePath === "string" ? candidate.sourcePath : "";
		const expectedPath =
			typeof candidate?.expectedPath === "string" ? candidate.expectedPath : "";
		return { linktext, sourcePath, expectedPath };
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
		// View の setState 後にタイトル再評価を確実に走らせる
		const leaf = this.leaf as WorkspaceLeaf & {
			updateHeader?: () => void;
		};
		leaf.updateHeader?.();
	}

	/**
	 * インラインタイトルの編集内容を linktext に反映する。
	 * newName にパス区切りが含まれている場合は、完全なパスとして扱う。
	 * そうでない場合は、既存のパスの最後のセグメントのみを置き換える。
	 */
	private updateLinktextFromTitle(newName: string): void {
		if (!newName) {
			return;
		}
		// newName にパス区切りが含まれている場合は、完全なパスとして扱う
		if (newName.includes("/")) {
			this.linktext = newName;
		} else {
			// パス区切りが含まれていない場合は、既存のパスの最後のセグメントのみを置き換える
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
	}

	private hydrateFromPersistedBootstrapState(): void {
		const leafId = getLeafId(this.leaf);
		if (!leafId) {
			return;
		}
		const persisted = persistedBootstrapStateByLeafId.get(leafId);
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
	}

	private hydrateFromPendingBootstrapState(): void {
		const leafId = getLeafId(this.leaf);
		if (!leafId) {
			return;
		}
		const pending = pendingBootstrapStateByLeafId.get(leafId);
		if (!pending) {
			return;
		}
		this.linktext = pending.linktext;
		this.sourcePath = pending.sourcePath;
		this.expectedPath = pending.expectedPath;
		persistedBootstrapStateByLeafId.set(leafId, pending);
		pendingBootstrapStateByLeafId.delete(leafId);
	}

	private readEphemeralState(): {
		linktext: string;
		sourcePath: string;
		expectedPath: string;
	} {
		const eState = this.leaf.getEphemeralState();
		if (!eState || typeof eState !== "object") {
			return { linktext: "", sourcePath: "", expectedPath: "" };
		}
		const raw = (eState as Record<string, unknown>)[
			PRE_CREATION_EPHEMERAL_STATE_KEY
		];
		if (!raw || typeof raw !== "object") {
			return { linktext: "", sourcePath: "", expectedPath: "" };
		}
		const candidate = raw as Record<string, unknown>;
		const linktext =
			typeof candidate.linktext === "string" ? candidate.linktext : "";
		const sourcePath =
			typeof candidate.sourcePath === "string" ? candidate.sourcePath : "";
		const expectedPath =
			typeof candidate.expectedPath === "string" ? candidate.expectedPath : "";
		return { linktext, sourcePath, expectedPath };
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
		};
		this.leaf.setEphemeralState(next);
	}

	private persistCurrentBootstrapState(): void {
		const leafId = getLeafId(this.leaf);
		if (!leafId) {
			return;
		}
		persistedBootstrapStateByLeafId.set(leafId, {
			linktext: this.linktext,
			sourcePath: this.sourcePath,
			expectedPath: this.expectedPath,
		});
	}

	protected getItems(): TwoHopIndexedLink[] {
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
		if (affectedPaths && affectedPaths.length > 0) {
			for (const path of affectedPaths) {
				if (this.hasCurrentItemKey(path)) {
					return true;
				}
			}
		}

		const affectedLookupKeys = context.affectedLookupKeys;
		if (!affectedLookupKeys || affectedLookupKeys.length === 0) {
			return true;
		}

		const currentLookupKey = this.getCurrentLookupKey();
		if (!currentLookupKey) {
			return false;
		}
		return affectedLookupKeys.some((lookupKey) => lookupKey === currentLookupKey);
	}

	/** ソースファイルを解決する（LinkContext 用）。見つからない場合は null */
	private resolveSourceFile(): TFile | null {
		if (!this.sourcePath) {
			return null;
		}
		return resolveFileByPath(this.app.vault, this.sourcePath);
	}

	protected render(): void {
		const container = this.prepareRenderContainer();

		// タイトルはパスの最後のセグメント（ファイル名部分）のみを表示・編集
		const titleText = this.expectedPath
			? (() => {
					const path = this.expectedPath.endsWith(".md")
						? this.expectedPath.slice(0, -3)
						: this.expectedPath;
					// パスの最後のセグメントのみを抽出
					return getPathBasename(path);
				})()
			: "Unresolved link target";

		const frame = buildEditorLikeFrame(container, {
			title: titleText,
			extraWrapperClasses: ["cosense-card-links-pre-create"],
		});
		const scrollerEl = frame.scrollerEl;
		this.setScrollerElement(scrollerEl);

		// Obsidian の inline-title を模倣した編集可能タイトル
		this.inlineTitleEl = frame.titleEl;
		this.inlineTitleEl.contentEditable = "true";
		this.inlineTitleEl.spellcheck = false;
		this.inlineTitleEl.setAttribute("autocapitalize", "on");
		this.inlineTitleEl.tabIndex = -1;
		this.inlineTitleEl.setAttribute("enterkeyhint", "done");
		this.inlineTitleEl.setAttribute("placeholder", "Untitled");
		this.inlineTitleEl.textContent = titleText;

		this.originalTitleText = titleText;
		this.titleCancelled = false;

		// 編集時: linktext / expectedPath を更新してボタン状態を同期
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
				this.inlineTitleEl?.blur();
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
			// expectedPath が空、または作成中の場合は何もしない
			if (!this.expectedPath || this.isCreating) {
				return;
			}
			// ファイルを作成
			void this.handleCreateAndOpen();
		});

		// 説明 + アクション（metadata-container 相当の位置に配置）
		const infoEl = frame.infoEl;

		if (this.expectedPath) {
		} else {
			infoEl.createEl("p", {
				text: "No target path is set for this temporary view.",
			});
		}

		const actionsEl = infoEl.createDiv({
			cls: "cosense-card-links-pre-create__actions",
		});

		this.createButtonEl = actionsEl.createEl("button", {
			cls: "mod-cta",
			text: "Create file",
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

		// 被リンクセクションは通常エディタと同様 .cm-scroller 直下（.cm-sizer の後）に配置
		this.mountBacklinksSection(scrollerEl);
	}

	private mountBacklinksSection(parentEl: HTMLElement): void {
		const backlinks = this.getItems();
		this.setCurrentItems(backlinks);

		// ソースファイルが解決できない場合は path: "" のダミーを使用
		const sourceFile = this.resolveSourceFile() ?? ({ path: "" } as TFile);

		const config: ListConfig<ViewItem> = {
			title: `Links to: ${this.linktext}`,
			showSectionHeader: true,
			sectionHeaderTitle: this.plugin.settings.useMergedLinksSection
				? "Links"
				: "Backlinks",
			paginationMode: "infinite-scroll",
			preserveResultsHeightOnSearch: false,
			itemComponent: ViewItemCard,
			getItemProps: (item: ViewItem) => ({
				item,
				settings: this.plugin.settings,
			}),
			getItemKey: getViewItemKey,
			sectionId: "pre-create-backlinks",
			emptyMessage: "他のノートからの未解決バックリンクは見つかりませんでした。",
		};

		this.mountListSection({
			parentEl,
			sourceFile,
			config,
			autofocus: false,
		});
	}

	protected getItemKey(backlink: TwoHopIndexedLink): string {
		return backlink.sourceFile.path;
	}

	protected getItemVersion(backlink: TwoHopIndexedLink): number {
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
			// 親ディレクトリが存在しない場合は作成する
			const lastSlashIndex = this.expectedPath.lastIndexOf("/");
			if (lastSlashIndex !== -1) {
				const dirPath = this.expectedPath.slice(0, lastSlashIndex);
				const folder = this.app.vault.getAbstractFileByPath(dirPath);
				if (!(folder instanceof TFolder)) {
					await this.app.vault.createFolder(dirPath);
				}
			}

			// vault.createを使用してファイルを作成
			const file = await this.app.vault.create(this.expectedPath, "");
			// 現在のleafでファイルを開く
			await this.leaf.openFile(file, { active: true });
		} catch (error) {
			console.error(
				"[Cosense card links] Failed to create unresolved file:",
				error,
			);
			new Notice("Failed to create file.");
		} finally {
			this.isCreating = false;
			if (this.leaf.view === this) {
				this.render();
			}
		}
	}
}
