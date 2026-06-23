import type { TFile } from "obsidian";
import type { ResolveProgress, TwoHopLinkResult } from "types";

type LoadOptions = {
	force?: boolean;
};

export interface LoadPreparation {
	shouldLoad: boolean;
	isBackgroundRefresh: boolean;
	requestId?: number;
}

export type ResolveTwoHopLinks = (
	file: TFile,
	onProgress?: (progress: ResolveProgress) => void,
) => Promise<TwoHopLinkResult>;

export type LoadExecutionResult =
	| {
			kind: "success";
			data: TwoHopLinkResult;
	  }
	| {
			kind: "error";
			error: Error;
			isBackgroundRefresh: boolean;
	  }
	| {
			kind: "stale";
	  };

export class TwoHopLinksLoader {
	private loadRequestSequence = 0;
	private currentFile: TFile | undefined = undefined;

	constructor(private readonly resolveTwoHopLinks: ResolveTwoHopLinks) {}

	getCurrentFile(): TFile | undefined {
		return this.currentFile;
	}

	prepareLoad(
		file: TFile,
		options: LoadOptions,
		hasExistingData: boolean,
	): LoadPreparation {
		const isSameFile = this.currentFile?.path === file.path;
		if (!options.force && isSameFile && hasExistingData) {
			return {
				shouldLoad: false,
				isBackgroundRefresh: false,
			};
		}

		const isBackgroundRefresh = !!options.force && isSameFile && hasExistingData;
		this.currentFile = file;

		return {
			shouldLoad: true,
			isBackgroundRefresh,
			requestId: ++this.loadRequestSequence,
		};
	}

	async executeLoad(
		file: TFile,
		requestId: number,
		isBackgroundRefresh: boolean,
		onProgress?: (progress: ResolveProgress) => void,
	): Promise<LoadExecutionResult> {
		try {
			const data = await this.resolveTwoHopLinks(file, (progress) => {
				if (!this.isCurrentRequest(requestId, file.path)) {
					return;
				}
				onProgress?.(progress);
			});
			if (!this.isCurrentRequest(requestId, file.path)) {
				return { kind: "stale" };
			}
			return {
				kind: "success",
				data,
			};
		} catch (error) {
			if (!this.isCurrentRequest(requestId, file.path)) {
				return { kind: "stale" };
			}
			return {
				kind: "error",
				error: this.toError(error),
				isBackgroundRefresh,
			};
		}
	}

	reset(): void {
		this.currentFile = undefined;
	}

	private isCurrentRequest(requestId: number, filePath: string): boolean {
		return (
			requestId === this.loadRequestSequence &&
			this.currentFile?.path === filePath
		);
	}

	private toError(value: unknown): Error {
		return value instanceof Error ? value : new Error(String(value));
	}
}
