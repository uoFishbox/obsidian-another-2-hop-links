import { normalizePath } from "obsidian";

export function normalizePathIdentity(path: string): string {
	return normalizePath(path).toLowerCase();
}

export function createFileUsageKey(path: string): string {
	return createFileUsageKeyFromNormalizedPath(normalizePath(path));
}

export function createFileUsageKeyFromNormalizedPath(path: string): string {
	return `f:${path.toLowerCase()}`;
}
