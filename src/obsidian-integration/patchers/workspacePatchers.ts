import {
	getLinkpath,
	normalizePath,
	TFile,
	type OpenViewState,
	type PaneType,
	type ViewState,
	type WorkspaceLeaf,
} from "obsidian";
import type { PluginHost } from "obsidian-integration/pluginHost";
import { toCaseInsensitiveLookupKey } from "indexing/link-resolution/linkResolution";
import {
	PRE_CREATION_EPHEMERAL_STATE_KEY,
	hasAnyPreCreationBootstrapState,
	setPendingPreCreationBootstrapState,
	setPersistedPreCreationBootstrapState,
	VIEW_TYPE_PRE_CREATE,
} from "two-hop/pre-creation/PreCreationView";
import { resolveExpectedPath } from "obsidian-integration/files/resolveExpectedPath";
import {
	isLeafHistoryInternal,
	type LeafHistoryInternal,
	type LeafWithInternalHistory,
	type NativeHistoryEntry,
} from "obsidian-integration/capabilities/obsidianInternals";
import { applyPatch } from "obsidian-integration/capabilities/applyPatch";

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
					// 1. Normalize the link and check whether it can be resolved
					// Also determine it from the note side for [[note#heading]] / [[note^block]]
					const rawLinkPath = getLinkpath(linktext);
					const destFile = plugin.app.metadataCache.getFirstLinkpathDest(
						rawLinkPath,
						sourcePath,
					);

					// Open the pre-creation view for every unresolved link.
					if (!destFile) {
						// Calculate the path that will actually be created
						const expectedPath = resolveExpectedPath(
							plugin.app,
							linktext,
							sourcePath,
						);
						const normalizedExpectedPath = normalizePath(expectedPath);

						const leaf = plugin.app.workspace.getLeaf(
							(newLeaf ?? false) as PaneType | boolean,
						);
						const inheritedState = (openViewState?.state ?? {}) as Record<
							string,
							unknown
						>;
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
								creationPath: normalizedExpectedPath,
							},
						};
						setPendingPreCreationBootstrapState(leaf, {
							linktext,
							sourcePath,
							expectedPath: normalizedExpectedPath,
							creationPath: normalizedExpectedPath,
						});
						setPersistedPreCreationBootstrapState(leaf, {
							linktext,
							sourcePath,
							expectedPath: normalizedExpectedPath,
							creationPath: normalizedExpectedPath,
						});
						const viewState: ViewState = {
							type: VIEW_TYPE_PRE_CREATE,
							state: {
								...inheritedState,
								linktext: linktext,
								sourcePath: sourcePath,
								expectedPath: normalizedExpectedPath,
								creationPath: normalizedExpectedPath,
							},
						};

						if (openViewState?.active !== undefined) {
							viewState.active = openViewState.active;
						}
						if (openViewState?.group !== undefined) {
							viewState.group = openViewState.group;
						}

						leaf.setEphemeralState(preCreationEphemeralState);
						await leaf.setViewState(viewState, preCreationEphemeralState);
						if (openViewState?.active !== false) {
							plugin.app.workspace.revealLeaf(leaf);
						}

						// Abort processing (do not create a new file)
						return;
					}
				} catch (e) {
					console.error(
						"[Cosense card links] Error in openLinkText patch:",
						e,
					);
					// On error, run the original operation for safety
				}

				// Run the original method when the condition does not match or an error occurs
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

		// Determine whether this is the currently active Leaf and preserve focus if it is active
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
