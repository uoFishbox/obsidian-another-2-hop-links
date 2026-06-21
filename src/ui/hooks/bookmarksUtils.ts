import { normalizePath } from "obsidian";

interface BookmarkNodeLike {
	type?: unknown;
	path?: unknown;
	items?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getRootItems = (value: unknown): unknown[] => {
	if (Array.isArray(value)) {
		return value;
	}

	if (!isObject(value)) {
		return [];
	}

	const items = (value as BookmarkNodeLike).items;
	return Array.isArray(items) ? items : [];
};

function collectBookmarkedFilePaths(node: unknown, paths: Set<string>): void {
	if (!isObject(node)) {
		return;
	}

	const bookmarkNode = node as BookmarkNodeLike;
	if (bookmarkNode.type === "file" && typeof bookmarkNode.path === "string") {
		paths.add(normalizePath(bookmarkNode.path));
	}

	if (!Array.isArray(bookmarkNode.items)) {
		return;
	}

	for (const item of bookmarkNode.items) {
		collectBookmarkedFilePaths(item, paths);
	}
}

export interface ParsedBookmarks {
	filePaths: Set<string>;
	orderedFilePaths: string[];
}

export function parseBookmarkedFilePaths(content: string): ParsedBookmarks {
	try {
		const parsed = JSON.parse(content) as unknown;
		const items = getRootItems(parsed);
		const orderedFilePaths: string[] = [];
		const seen = new Set<string>();

		for (const item of items) {
			collectOrderedBookmarkedFilePaths(item, orderedFilePaths, seen);
		}

		return {
			filePaths: new Set(orderedFilePaths),
			orderedFilePaths,
		};
	} catch {
		return {
			filePaths: new Set<string>(),
			orderedFilePaths: [],
		};
	}
}

function collectOrderedBookmarkedFilePaths(
	node: unknown,
	orderedFilePaths: string[],
	seen: Set<string>,
): void {
	if (!isObject(node)) {
		return;
	}

	const bookmarkNode = node as BookmarkNodeLike;
	if (
		bookmarkNode.type === "file" &&
		typeof bookmarkNode.path === "string"
	) {
		const normalized = normalizePath(bookmarkNode.path);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			orderedFilePaths.push(normalized);
		}
	}

	if (!Array.isArray(bookmarkNode.items)) {
		return;
	}

	for (const item of bookmarkNode.items) {
		collectOrderedBookmarkedFilePaths(item, orderedFilePaths, seen);
	}
}
