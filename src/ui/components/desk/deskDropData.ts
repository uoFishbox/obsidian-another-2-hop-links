import { TFile, normalizePath, parseLinktext, type App } from "obsidian";
import { resolveFileByPath } from "infrastructure/utils/vaultUtils";
import { CANVAS_NOTE_DRAG_FORMAT } from "../../../appConstants";

export const DESK_CARD_DRAG_FORMAT = "cosense-card-links/desk-card-path";

const TEXT_DROP_FORMATS = [
	"text/plain",
	"text/uri-list",
	"text/x-moz-url",
] as const;

type ObsidianDraggable = {
	type?: string;
	file?: unknown;
	files?: unknown[];
	linktext?: string;
	sourcePath?: string;
};

type AppWithDragManager = App & {
	dragManager?: {
		draggable?: ObsidianDraggable | null;
	};
};

function hasType(dataTransfer: DataTransfer, type: string): boolean {
	return Array.from(dataTransfer.types ?? []).includes(type);
}

export function canAcceptDeskDrop(
	dataTransfer: DataTransfer | null | undefined,
	app?: App,
): boolean {
	const draggable = getDraggable(app);
	if (
		draggable &&
		((draggable.type === "file" && draggable.file instanceof TFile) ||
			(draggable.type === "files" && draggable.files?.some(isTFile)) ||
			(draggable.type === "link" &&
				(draggable.file instanceof TFile ||
					Boolean(draggable.linktext))))
	) {
		return true;
	}

	if (draggable?.type === "bookmarks") {
		return true;
	}

	if (!dataTransfer) {
		return false;
	}

	return (
		hasType(dataTransfer, DESK_CARD_DRAG_FORMAT) ||
		hasType(dataTransfer, CANVAS_NOTE_DRAG_FORMAT) ||
		hasType(dataTransfer, "Files") ||
		TEXT_DROP_FORMATS.some((type) => hasType(dataTransfer, type))
	);
}

export function resolveDeskDropFile(
	app: App,
	dataTransfer: DataTransfer | null | undefined,
	sourcePath = "",
): TFile | null {
	if (!dataTransfer) {
		return resolveDraggableFile(app, sourcePath);
	}

	const customPath =
		dataTransfer.getData(DESK_CARD_DRAG_FORMAT) ||
		dataTransfer.getData(CANVAS_NOTE_DRAG_FORMAT);

	const customFile = resolveVaultPath(app, customPath);
	if (customFile) {
		return customFile;
	}

	const draggableFile = resolveDraggableFile(app, sourcePath);
	if (draggableFile) {
		return draggableFile;
	}

	for (const type of TEXT_DROP_FORMATS) {
		const data = dataTransfer.getData(type);
		if (!data) {
			continue;
		}

		const file = resolveTextData(app, data, sourcePath);
		if (file) {
			return file;
		}
	}

	return resolveNativeFile(app, dataTransfer.files);
}

function getDraggable(app: App | undefined): ObsidianDraggable | null {
	return (
		(app as AppWithDragManager | undefined)?.dragManager?.draggable ?? null
	);
}

function resolveDraggableFile(
	app: App,
	fallbackSourcePath: string,
): TFile | null {
	const draggable = getDraggable(app);
	if (!draggable) {
		return null;
	}

	if (draggable.type === "file") {
		return draggable.file instanceof TFile ? draggable.file : null;
	}

	if (draggable.type === "files") {
		return draggable.files?.find(isTFile) ?? null;
	}

	if (draggable.type !== "link") {
		return null;
	}

	if (draggable.file instanceof TFile) {
		return draggable.file;
	}

	if (!draggable.linktext) {
		return null;
	}

	return resolveWikiLink(
		app,
		draggable.linktext,
		draggable.sourcePath ?? fallbackSourcePath,
	);
}

function isTFile(value: unknown): value is TFile {
	return value instanceof TFile;
}

function resolveTextData(
	app: App,
	text: string,
	sourcePath: string,
): TFile | null {
	for (const candidate of extractCandidates(text)) {
		const file =
			resolveVaultPath(app, candidate) ??
			resolveWikiLink(app, candidate, sourcePath) ??
			resolveObsidianUrl(app, candidate) ??
			resolveFileUrl(app, candidate);

		if (file) {
			return file;
		}
	}

	return null;
}

function extractCandidates(text: string): string[] {
	const trimmed = text.trim();
	const candidates: string[] = [];

	if (!trimmed) {
		return candidates;
	}

	candidates.push(trimmed);

	for (const line of trimmed.split(/\r?\n/)) {
		const lineText = line.trim();
		if (lineText && !lineText.startsWith("#")) {
			candidates.push(lineText);
		}
	}

	for (const match of trimmed.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
		candidates.push(match[1]);
	}

	for (const match of trimmed.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
		candidates.push(match[1]);
	}

	return candidates;
}

function resolveVaultPath(app: App, rawPath: string): TFile | null {
	const path = cleanPath(rawPath);
	if (!path) {
		return null;
	}

	return resolveFileByPath(app.vault, path);
}

function resolveWikiLink(
	app: App,
	rawText: string,
	sourcePath: string,
): TFile | null {
	const cleaned = cleanLinkText(rawText);
	if (!cleaned) {
		return null;
	}

	const { path } = parseLinktext(cleaned);
	const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);

	return file instanceof TFile ? file : null;
}

function resolveObsidianUrl(app: App, rawText: string): TFile | null {
	let url: URL;

	try {
		url = new URL(rawText.trim());
	} catch {
		return null;
	}

	if (url.protocol !== "obsidian:") {
		return null;
	}

	const fileParam =
		url.searchParams.get("file") ?? url.searchParams.get("path");
	if (!fileParam) {
		return null;
	}

	return resolveVaultPath(app, decodeURIComponentSafe(fileParam));
}

function resolveFileUrl(app: App, rawText: string): TFile | null {
	let url: URL;

	try {
		url = new URL(rawText.trim());
	} catch {
		return null;
	}

	if (url.protocol !== "file:") {
		return null;
	}

	return resolveAbsolutePath(app, decodeURIComponentSafe(url.pathname));
}

function resolveNativeFile(
	app: App,
	files: FileList | null | undefined,
): TFile | null {
	if (!files) {
		return null;
	}

	for (const file of Array.from(files)) {
		const path = (file as File & { path?: string }).path;
		if (!path) {
			continue;
		}

		const resolved = resolveAbsolutePath(app, path);
		if (resolved) {
			return resolved;
		}
	}

	return null;
}

function resolveAbsolutePath(app: App, absolutePath: string): TFile | null {
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	const basePath = adapter.getBasePath?.();

	if (!basePath) {
		return null;
	}

	const normalizedBase = normalizePath(basePath);
	const normalizedPath = normalizePath(absolutePath);
	const comparableBase = normalizedBase.toLowerCase();
	const comparablePath = normalizedPath.toLowerCase();

	if (!comparablePath.startsWith(`${comparableBase}/`)) {
		return null;
	}

	const vaultRelativePath = normalizedPath.slice(normalizedBase.length + 1);
	return resolveVaultPath(app, vaultRelativePath);
}

function cleanPath(rawPath: string): string {
	return normalizePath(
		cleanLinkText(rawPath).split("#")[0].split("^")[0].trim(),
	);
}

function cleanLinkText(rawText: string): string {
	let text = rawText.trim();

	text = text.replace(/^<|>$/g, "");

	if (text.startsWith("![[") && text.endsWith("]]")) {
		text = text.slice(3, -2);
	} else if (text.startsWith("[[") && text.endsWith("]]")) {
		text = text.slice(2, -2);
	}

	return decodeURIComponentSafe(text.split("|")[0].trim());
}

function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
