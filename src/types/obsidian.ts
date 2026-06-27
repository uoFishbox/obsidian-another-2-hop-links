import type { TFile, CachedMetadata, TAbstractFile, WorkspaceLeaf } from "obsidian";

import { type CanvasViewCanvas } from "obsidian-typings";

export type { CachedMetadata };

export type ObsidianLinkMap = Record<string, Record<string, number>>;

export interface CanvasNodeData {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	type: "text" | "file" | "group" | "link";
	[key: string]: any;
}

export interface CanvasView {
	canvas: CanvasViewCanvas;
	file?: TFile;
}

export interface CanvasNode {
	id: string;
	canvas?: CanvasViewCanvas;
	setIsEditing(editing: boolean): void;
	[key: string]: any;
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
	getBacklinksForFile(file: TFile): CustomArrayDict<any>;
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
