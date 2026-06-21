import { WorkspaceLeaf } from "obsidian";

export function getLeafId(leaf: WorkspaceLeaf): string | undefined {
	return (leaf as WorkspaceLeaf & { id?: string }).id;
}
