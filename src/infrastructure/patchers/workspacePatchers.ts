import {
	getLinkpath,
	normalizePath,
	TFile,
	type OpenViewState,
	type PaneType,
	type ViewState,
	type WorkspaceLeaf,
} from "obsidian";
import type { PluginHost } from "types/pluginHost";
import {
	normalizeLinkToMarkdownPath,
	toCaseInsensitiveLookupKey,
} from "core/indexing/link-resolution/linkResolution";
import {
	PRE_CREATION_EPHEMERAL_STATE_KEY,
	hasAnyPreCreationBootstrapState,
	setPendingPreCreationBootstrapState,
	setPersistedPreCreationBootstrapState,
	VIEW_TYPE_PRE_CREATE,
} from "features/pre-creation/ui/PreCreationView";
import { resolveExpectedPath } from "shared/obsidian/resolveExpectedPath";
import {
	isLeafHistoryInternal,
	type LeafHistoryInternal,
	type LeafWithInternalHistory,
	type NativeHistoryEntry,
} from "infrastructure/capabilities/obsidianInternals";
import { applyPatch } from "infrastructure/capabilities/applyPatch";

type MaterializedTrigger = "file-open" | "vault-create";

export function initWorkspacePatcher(plugin: PluginHost): void {
	plugin.app.workspace.onLayoutReady(() => {
		patchWorkspaceOpenLinkText(plugin);
		registerPreCreationHistoryCleanup(plugin);
	});
}

function patchWorkspaceOpenLinkText(plugin: PluginHost): void {
	applyPatch(plugin, {
		id: "workspace:openLinkText",
		target: plugin.app.workspace,
		method: "openLinkText",
		wrap: (next) =>
			async function (
				this: unknown,
				linktext: string,
				sourcePath: string,
				newLeaf?: boolean | PaneType,
				openViewState?: OpenViewState & {
					bypassCosenseCardLinks?: boolean;
				},
			) {
				if (openViewState && openViewState.bypassCosenseCardLinks) {
					return next.call(
						this,
						linktext,
						sourcePath,
						newLeaf,
						openViewState,
					);
				}

				if (!plugin.settings.enableUnresolvedLinkModal) {
					return next.call(
						this,
						linktext,
						sourcePath,
						newLeaf,
						openViewState,
					);
				}

				try {
					// 1. リンクを正規化して解決可能かチェック
					// [[note#heading]] / [[note^block]] でも note 側で判定する
					const rawLinkPath = getLinkpath(linktext);
					const destFile = plugin.app.metadataCache.getFirstLinkpathDest(
						rawLinkPath,
						sourcePath,
					);

					// 解決先が存在しない（未解決リンク）場合のみ処理を行う
					if (!destFile) {
						const indexingService = plugin.indexingService;

						if (indexingService) {
							const lookupPath = normalizeLinkToMarkdownPath(rawLinkPath);

							const hasMultipleBacklinks =
								indexingService.hasAtLeastUniqueBacklinkSources(
									lookupPath,
									2,
									{
										requireExistingSourceFile: true,
									},
								);

							if (hasMultipleBacklinks) {
								// 実際に作成されるパスを計算
								const expectedPath = resolveExpectedPath(
									plugin.app,
									linktext,
									sourcePath,
								);
								const normalizedExpectedPath =
									normalizePath(expectedPath);

								const leaf = plugin.app.workspace.getLeaf(
									(newLeaf ?? false) as PaneType | boolean,
								);
								const inheritedState = (openViewState?.state ??
									{}) as Record<string, unknown>;
								const inheritedEphemeralState =
									asRecord(openViewState?.eState) ??
									asRecord(leaf.getEphemeralState()) ??
									{};
								const preCreationEphemeralState = {
									...inheritedEphemeralState,
									[PRE_CREATION_EPHEMERAL_STATE_KEY]: {
										linktext: linktext,
										sourcePath: sourcePath,
										expectedPath: normalizedExpectedPath,
									},
								};
								setPendingPreCreationBootstrapState(leaf, {
									linktext,
									sourcePath,
									expectedPath: normalizedExpectedPath,
								});
								setPersistedPreCreationBootstrapState(leaf, {
									linktext,
									sourcePath,
									expectedPath: normalizedExpectedPath,
								});
								const viewState: ViewState = {
									type: VIEW_TYPE_PRE_CREATE,
									state: {
										...inheritedState,
										linktext: linktext,
										sourcePath: sourcePath,
										expectedPath: normalizedExpectedPath,
									},
								};

								if (openViewState?.active !== undefined) {
									viewState.active = openViewState.active;
								}
								if (openViewState?.group !== undefined) {
									viewState.group = openViewState.group;
								}

								leaf.setEphemeralState(preCreationEphemeralState);
								await leaf.setViewState(
									viewState,
									preCreationEphemeralState,
								);
								if (openViewState?.active !== false) {
									plugin.app.workspace.revealLeaf(leaf);
								}

								// 処理を中断（新規作成を行わない）
								return;
							}
						}
					}
				} catch (e) {
					console.error(
						"[Cosense card links] Error in openLinkText patch:",
						e,
					);
					// エラー時は安全のため元の処理を実行する
				}

				// 条件に合致しない、またはエラー時は元のメソッドを実行
				return next.call(this, linktext, sourcePath, newLeaf, openViewState);
			},
	});
}

function registerPreCreationHistoryCleanup(plugin: PluginHost): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-open", (openedFile) => {
			if (!openedFile) {
				return;
			}
			void handleMaterializedFile(plugin, openedFile, "file-open");
		}),
	);

	plugin.registerEvent(
		plugin.app.vault.on("create", (createdFile) => {
			if (!(createdFile instanceof TFile)) {
				return;
			}
			void handleMaterializedFile(plugin, createdFile, "vault-create");
		}),
	);
}

async function handleMaterializedFile(
	plugin: PluginHost,
	file: TFile,
	trigger: MaterializedTrigger,
): Promise<void> {
	try {
		const createdPath = normalizePath(file.path);
		if (!hasAnyPreCreationBootstrapState()) {
			return;
		}
		await replaceMatchingPreCreationLeaves(plugin, file, createdPath, trigger);

		cleanupPreCreationHistoryForPath(plugin, createdPath);
		setTimeout(() => {
			cleanupPreCreationHistoryForPath(plugin, createdPath);
		}, 50);
	} catch (error) {
		console.error(
			`[WorkspacePatcher] Failed to process "${file.path}" (${trigger}):`,
			error,
		);
	}
}

async function replaceMatchingPreCreationLeaves(
	plugin: PluginHost,
	file: TFile,
	createdPath: string,
	trigger: MaterializedTrigger,
): Promise<void> {
	const replacementTasks: Promise<void>[] = [];

	plugin.app.workspace.iterateAllLeaves((leaf) => {
		const viewState = safeReadLeafViewState(leaf);
		if (!isMatchingPreCreationViewState(viewState, createdPath)) {
			return;
		}

		// 現在アクティブなLeafかどうかを判定し、アクティブな場合はフォーカスを維持する
		const isActiveLeaf = plugin.app.workspace.activeLeaf === leaf;

		replacementTasks.push(
			leaf.openFile(file, { active: isActiveLeaf }).catch((error) => {
				console.error(
					`[WorkspacePatcher] Failed to replace pre-creation leaf for "${createdPath}" (${trigger}):`,
					error,
				);
			}),
		);
	});

	if (replacementTasks.length === 0) {
		return;
	}

	await Promise.all(replacementTasks);
}

function safeReadLeafViewState(
	leaf: WorkspaceLeaf,
): { type?: unknown; state?: unknown } | null {
	try {
		return leaf.getViewState();
	} catch {
		return null;
	}
}

function isMatchingPreCreationViewState(
	viewState: { type?: unknown; state?: unknown } | null,
	createdPath: string,
): boolean {
	if (!viewState || viewState.type !== VIEW_TYPE_PRE_CREATE) {
		return false;
	}

	const stateObj = asRecord(viewState.state);
	if (!stateObj) {
		return false;
	}

	return isMatchingPreCreationState(stateObj, createdPath);
}

function cleanupPreCreationHistoryForPath(
	plugin: PluginHost,
	createdPath: string,
): void {
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		const internalHistory = getInternalHistory(leaf);
		if (!internalHistory) {
			return;
		}

		const filteredBackHistory = internalHistory.backHistory.filter((entry) => {
			const shouldRemove = isMatchingPreCreationEntry(entry, createdPath);
			return !shouldRemove;
		});

		const filteredForwardHistory = internalHistory.forwardHistory.filter(
			(entry) => {
				const shouldRemove = isMatchingPreCreationEntry(entry, createdPath);
				return !shouldRemove;
			},
		);

		if (
			filteredBackHistory.length === internalHistory.backHistory.length &&
			filteredForwardHistory.length === internalHistory.forwardHistory.length
		) {
			return;
		}

		internalHistory.deserialize({
			backHistory: filteredBackHistory,
			forwardHistory: filteredForwardHistory,
		});

		const leafWithInternalHistory = leaf as LeafWithInternalHistory;
		if (typeof leafWithInternalHistory.trigger === "function") {
			leafWithInternalHistory.trigger("history-change");
		}
	});
}

function getInternalHistory(leaf: WorkspaceLeaf): LeafHistoryInternal | null {
	const maybeHistory = (leaf as LeafWithInternalHistory).history;
	if (!isLeafHistoryInternal(maybeHistory)) {
		return null;
	}

	return maybeHistory;
}

function isMatchingPreCreationEntry(
	entry: NativeHistoryEntry,
	createdPath: string,
): boolean {
	const viewState = extractViewStateFromHistoryEntry(entry);
	if (!viewState) {
		return false;
	}

	if (viewState.type !== VIEW_TYPE_PRE_CREATE) {
		return false;
	}

	const stateObj = asRecord(viewState.state);
	if (!stateObj) {
		return false;
	}

	return isMatchingPreCreationState(stateObj, createdPath);
}

function isMatchingPreCreationState(
	stateObj: Record<string, unknown>,
	createdPath: string,
): boolean {
	const createdPathKey = toCaseInsensitiveLookupKey(createdPath);
	const virtualPath =
		typeof stateObj.virtualPath === "string"
			? toCaseInsensitiveLookupKey(stateObj.virtualPath)
			: undefined;
	const expectedPath =
		typeof stateObj.expectedPath === "string"
			? toCaseInsensitiveLookupKey(stateObj.expectedPath)
			: undefined;
	const filePath =
		typeof stateObj.file === "string"
			? toCaseInsensitiveLookupKey(stateObj.file)
			: undefined;

	return (
		virtualPath === createdPathKey ||
		expectedPath === createdPathKey ||
		filePath === createdPathKey
	);
}

function extractViewStateFromHistoryEntry(entry: NativeHistoryEntry): {
	type?: unknown;
	state?: unknown;
} | null {
	const rawState = entry.state;
	if (!rawState) {
		return null;
	}

	if (typeof rawState === "string") {
		try {
			const parsed = JSON.parse(rawState);
			return asRecord(parsed) as { type?: unknown; state?: unknown };
		} catch {
			return null;
		}
	}

	if (!asRecord(rawState)) {
		return null;
	}

	return rawState as { type?: unknown; state?: unknown };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}
