import type { WorkspaceLeaf } from "obsidian";
import { getLeafId } from "obsidian-integration/workspace/workspaceLeafIdentity";

export const PRE_CREATION_EPHEMERAL_STATE_KEY = "cosense-card-links-pre-create";

export interface PreCreationBootstrapState {
	readonly linktext: string;
	readonly sourcePath: string;
	readonly expectedPath: string;
	readonly creationPath: string;
}

const pendingBootstrapStateByLeafId = new Map<string, PreCreationBootstrapState>();
const persistedBootstrapStateByLeafId = new Map<string, PreCreationBootstrapState>();

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
	if (!leafId) return;
	pendingBootstrapStateByLeafId.set(leafId, state);
}

export function setPersistedPreCreationBootstrapState(
	leaf: WorkspaceLeaf,
	state: PreCreationBootstrapState,
): void {
	const leafId = getLeafId(leaf);
	if (!leafId) return;
	persistedBootstrapStateByLeafId.set(leafId, state);
}

export function takePendingPreCreationBootstrapState(
	leaf: WorkspaceLeaf,
): PreCreationBootstrapState | undefined {
	const leafId = getLeafId(leaf);
	if (!leafId) return undefined;
	const pending = pendingBootstrapStateByLeafId.get(leafId);
	if (!pending) return undefined;
	persistedBootstrapStateByLeafId.set(leafId, pending);
	pendingBootstrapStateByLeafId.delete(leafId);
	return pending;
}

export function getPersistedPreCreationBootstrapState(
	leaf: WorkspaceLeaf,
): PreCreationBootstrapState | undefined {
	const leafId = getLeafId(leaf);
	return leafId ? persistedBootstrapStateByLeafId.get(leafId) : undefined;
}
