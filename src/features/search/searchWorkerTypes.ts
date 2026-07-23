import type { Pos } from "obsidian";

export interface SearchWorkerItemSnapshot {
	key: string;
	searchText: string;
	targetFilePath: string | null;
}

export type SearchWorkerMatchScope = "title-only" | "title-and-content";

export interface SearchWorkerFileContentSnapshot {
	path: string;
	content: string;
	mtime: number;
}

export interface SearchWorkerDatasetSnapshot {
	datasetVersion: number;
	items: readonly SearchWorkerItemSnapshot[];
	fileContents: SearchWorkerFileContentSnapshot[];
}

export interface SearchWorkerItemsSnapshot {
	datasetVersion: number;
	items: readonly SearchWorkerItemSnapshot[];
}

export interface SearchWorkerFileContentsUpsert {
	datasetVersion: number;
	entries: SearchWorkerFileContentSnapshot[];
}

export interface SearchWorkerFileContentsRemoval {
	datasetVersion: number;
	paths: string[];
}

export interface SearchWorkerFilterRequest {
	requestId: number;
	datasetVersion: number;
	query: string;
	matchScope?: SearchWorkerMatchScope;
}

export interface SearchWorkerMatchedItem {
	key: string;
	titleMatched: boolean;
	contentMatched: boolean;
	contentPreview?: string;
	contentPosition?: Pos;
}

export interface SearchWorkerFilterResult {
	type: "filter-result";
	requestId: number;
	datasetVersion: number;
	matchedKeys?: string[];
	matchedItems?: SearchWorkerMatchedItem[];
}

export interface SearchWorkerErrorMessage {
	type: "error";
	requestId?: number;
	message: string;
}

export interface SyncItemsMessage {
	type: "sync-items";
	datasetVersion: number;
	items: readonly SearchWorkerItemSnapshot[];
}

export interface UpsertFileContentsMessage {
	type: "upsert-file-contents";
	datasetVersion: number;
	entries: SearchWorkerFileContentSnapshot[];
}

export interface RemoveFileContentsMessage {
	type: "remove-file-contents";
	datasetVersion: number;
	paths: string[];
}

export interface FilterMessage extends SearchWorkerFilterRequest {
	type: "filter";
}

export interface DisposeMessage {
	type: "dispose";
}

export type MainToSearchWorkerMessage =
	| SyncItemsMessage
	| UpsertFileContentsMessage
	| RemoveFileContentsMessage
	| FilterMessage
	| DisposeMessage;

export type SearchWorkerToMainMessage =
	| SearchWorkerFilterResult
	| SearchWorkerErrorMessage;
