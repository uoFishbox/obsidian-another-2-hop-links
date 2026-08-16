import type { Workspace } from "obsidian";

/**
 * Returns every Document currently owned by an Obsidian workspace leaf.
 *
 * Popout leaves live in their own realm, so querying or observing the
 * module-global `document` only sees the main window. Workspace leaf containers
 * give us the authoritative ownerDocument for each live realm. Accepts a
 * missing workspace (partial test mocks, teardown) and falls back to the
 * global document in realm-capable environments.
 */
export function collectWorkspaceDocuments(
	workspace: Workspace | undefined | null,
): Set<Document> {
	const documents = new Set<Document>();

	const workspaceDocument = workspace?.containerEl?.ownerDocument;
	if (workspaceDocument) {
		documents.add(workspaceDocument);
	}

	const iterateAllLeaves = workspace?.iterateAllLeaves;
	if (typeof iterateAllLeaves === "function") {
		iterateAllLeaves.call(workspace, (leaf) => {
			const ownerDocument = leaf.view?.containerEl?.ownerDocument;
			if (ownerDocument) {
				documents.add(ownerDocument);
			}
		});
	}

	if (documents.size === 0 && typeof document !== "undefined") {
		documents.add(document);
	}

	return documents;
}

/**
 * Picks the workspace document that is most likely to be receiving user input.
 * This avoids binding global plugin work to the main Electron window when the
 * user is actively working in a popout.
 *
 * Called from hot paths (indexing checkpoints, frame scheduling), so resolve
 * focus, visibility, and insertion-order fallback in one pass over the set
 * instead of allocating arrays for chained `find` calls.
 */
export function resolveWorkspaceDocument(
	workspace: Workspace | undefined | null,
): Document | null {
	const documents = collectWorkspaceDocuments(workspace);
	let fallback: Document | null = null;
	for (const doc of documents) {
		if (fallback === null) {
			fallback = doc;
		} else if (
			fallback.visibilityState !== "visible" &&
			doc.visibilityState === "visible"
		) {
			fallback = doc;
		}
		try {
			if (doc.hasFocus()) return doc;
		} catch {
			// Cross-realm focus queries can fail; keep scanning.
		}
	}
	return fallback;
}

export function resolveWorkspaceWindow(
	workspace: Workspace | undefined | null,
): Window | null {
	return resolveWorkspaceDocument(workspace)?.defaultView ?? null;
}
