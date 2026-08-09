import type { TFile } from "obsidian";
import type { ResolveProgress } from "types";
import type { TwoHopResolveSnapshot } from "features/two-hop/domain/ResolverDependencies";

type LoadOptions = {
	force?: boolean;
};

export type LoadPreparation =
	| {
			shouldLoad: false;
			isBackgroundRefresh: false;
	  }
	| {
			shouldLoad: true;
			isBackgroundRefresh: boolean;
			requestId: number;
			signal: AbortSignal;
	  };

export type ResolveTwoHopLinks = (
	file: TFile,
	onProgress?: (progress: ResolveProgress) => void,
	signal?: AbortSignal,
) => Promise<TwoHopResolveSnapshot>;

export type LoadExecutionResult =
	| {
			kind: "success";
			snapshot: TwoHopResolveSnapshot;
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
	private activeAbortController: AbortController | undefined;

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
		this.activeAbortController?.abort();
		const abortController = new AbortController();
		this.activeAbortController = abortController;
		this.currentFile = file;

		return {
			shouldLoad: true,
			isBackgroundRefresh,
			requestId: ++this.loadRequestSequence,
			signal: abortController.signal,
		};
	}

	async executeLoad(
		file: TFile,
		requestId: number,
		isBackgroundRefresh: boolean,
		signal: AbortSignal,
		onProgress?: (progress: ResolveProgress) => void,
	): Promise<LoadExecutionResult> {
		try {
			const snapshot = await this.resolveTwoHopLinks(
				file,
				(progress) => {
					if (!this.isCurrentRequest(requestId, file.path)) {
						return;
					}
					onProgress?.(progress);
				},
				signal,
			);
			if (!this.isCurrentRequest(requestId, file.path)) {
				return { kind: "stale" };
			}
			return {
				kind: "success",
				snapshot,
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
		} finally {
			if (this.activeAbortController?.signal === signal) {
				this.activeAbortController = undefined;
			}
		}
	}

	reset(): void {
		this.activeAbortController?.abort();
		this.activeAbortController = undefined;
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
