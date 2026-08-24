import type { CachedMetadata, TAbstractFile, TFile } from "obsidian";

export type { CachedMetadata };

export type ObsidianLinkMap = Record<string, Record<string, number>>;

export interface CanvasNodeData {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	type: "text" | "file" | "group" | "link";
	file?: unknown;
	[key: string]: unknown;
}

export interface CustomArrayDict<T> {
	data: Map<string, T[]>;
	keys(): string[];
	get(key: string): T[] | null;
}

export interface IMetadataCache {
	getFileCache(file: TFile): CachedMetadata | null;
	getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;
	fileToLinktext(file: TFile, sourcePath: string, omitMdExtension?: boolean): string;
	getBacklinksForFile(file: TFile): CustomArrayDict<unknown>;
	resolvedLinks: ObsidianLinkMap;
	unresolvedLinks: ObsidianLinkMap;
}

export interface IVault {
	getFiles(): TFile[];
	getMarkdownFiles(): TFile[];
	getAbstractFileByPath(path: string): TAbstractFile | null;
	cachedRead(file: TFile): Promise<string>;
	getResourcePath(file: TFile): string;
}

export type FileToLinktext = (
	file: TFile,
	sourcePath: string,
	omitMdExtension?: boolean,
) => string;
