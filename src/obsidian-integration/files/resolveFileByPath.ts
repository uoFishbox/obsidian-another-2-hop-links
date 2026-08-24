import { TFile } from "obsidian";
import type { IVault } from "obsidian-integration/hostContracts";

export function resolveFileByPath(vault: IVault, path: string): TFile | null {
	const abstractFile = vault.getAbstractFileByPath(path);
	return abstractFile instanceof TFile ? abstractFile : null;
}
