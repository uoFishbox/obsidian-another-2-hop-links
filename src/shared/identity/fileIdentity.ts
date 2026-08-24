import { normalizePath } from "obsidian";

export function normalizePathIdentity(path: string): string {
	return normalizePath(path).toLowerCase();
}

export function createFileUsageKey(path: string): string {
	return `f:${normalizePathIdentity(path)}`;
}
