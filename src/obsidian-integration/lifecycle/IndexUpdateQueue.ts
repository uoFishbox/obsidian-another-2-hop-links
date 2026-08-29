import { TFile, TFolder, debounce, normalizePath } from "obsidian";
import {
	INDEXING_DEBOUNCE_DELAY_MS,
	isIndexLinkCapableExtension,
} from "indexing/config";
import type { IncrementalFileChange } from "indexing/indexState";
import { FileChangeQueue } from "indexing/index-service/FileChangeQueue";
import type { IndexingService } from "indexing/index-service/IndexingService";
import type { PluginHost } from "obsidian-integration/pluginHost";
import { InitialScanChangeRecorder } from "./InitialScanChangeRecorder";

type InitialFullScanState = "pending" | "running" | "failed" | "completed";

export class IndexUpdateQueue {
	private debouncedProcessPending: () => void;
	private readonly changeQueue = new FileChangeQueue();
	private readonly initialChangeRecorder = new InitialScanChangeRecorder();
	private readonly queueIdleWaiters: Set<() => void> = new Set();
	private readonly metadataResolveWaiters: Set<() => void> = new Set();
	private readonly initialFullScanReady: Promise<void>;
	private resolveInitialFullScanReady: (() => void) | undefined;
	private initialFullScanTimer: number | undefined;
	private unsubscribeIndexIdleWaiter: (() => void) | undefined;
	private isProcessingPendingChanges = false;
	private hasAttemptedAutomaticRecovery = false;
	private initialFullScanState: InitialFullScanState = "pending";
	private waitsForMetadataResolve = false;
	private metadataResolveGeneration = 0;
	private destroyed = false;

	constructor(
		private plugin: PluginHost,
		private indexingService: IndexingService,
	) {
		this.initialFullScanReady = new Promise<void>((resolve) => {
			this.resolveInitialFullScanReady = resolve;
		});
		this.debouncedProcessPending = debounce(
			() => {
				void this.processPendingChanges().catch((error) => {
					console.error(
						"[IndexUpdateQueue] Failed to process pending changes:",
						error,
					);
				});
			},
			INDEXING_DEBOUNCE_DELAY_MS,
			true,
		);
		this.unsubscribeIndexIdleWaiter = this.indexingService.registerIdleWaiter(
			async () => {
				await this.awaitQueueIdle();
				await this.initialFullScanReady;
			},
		);
	}

	public destroy(): void {
		this.destroyed = true;
		this.unsubscribeIndexIdleWaiter?.();
		this.unsubscribeIndexIdleWaiter = undefined;
		if (this.initialFullScanTimer !== undefined) {
			window.clearTimeout(this.initialFullScanTimer);
			this.initialFullScanTimer = undefined;
		}
		(this.debouncedProcessPending as { cancel?: () => void }).cancel?.();
		this.queueIdleWaiters.forEach((resolve) => resolve());
		this.queueIdleWaiters.clear();
		this.metadataResolveWaiters.forEach((resolve) => resolve());
		this.metadataResolveWaiters.clear();
		this.resolveInitialFullScanReady?.();
		this.resolveInitialFullScanReady = undefined;
	}

	public async awaitQueueIdle(): Promise<void> {
		while (!this.isQueueIdle()) {
			if (this.destroyed) {
				return;
			}
			await new Promise<void>((resolve) => {
				this.queueIdleWaiters.add(resolve);
			});
		}
	}

	public requestIndexUpdateForFile(path: string): void {
		if (this.destroyed) {
			return;
		}
		this.recordObservedChange({ type: "modify", path });
	}

	setupEventListeners(): void {
		this.registerVaultListeners();

		this.plugin.app.workspace.onLayoutReady(() => {
			if (this.destroyed) {
				return;
			}
			this.initialFullScanTimer = window.setTimeout(() => {
				this.initialFullScanTimer = undefined;
				if (this.destroyed) {
					return;
				}
				void this.runInitialFullScan().catch((error) => {
					console.error(
						"[IndexUpdateQueue] Initial full scan failed:",
						error,
					);
				});
			}, 100);
		});

		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on("resolved", () => {
				this.handleMetadataResolved();
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on("changed", (file: TFile) => {
				if (this.destroyed) {
					return;
				}
				if (!(file instanceof TFile)) {
					return;
				}
				if (!isIndexLinkCapableExtension(file.extension)) {
					return;
				}
				this.recordObservedChange({
					type: "modify",
					path: file.path,
				});
			}),
		);
	}

	private registerVaultListeners(): void {
		if (this.destroyed) {
			return;
		}
		this.plugin.registerEvent(
			this.plugin.app.vault.on("rename", (file, oldPath) => {
				if (this.destroyed) {
					return;
				}
				if (!(file instanceof TFile) && !(file instanceof TFolder)) {
					return;
				}
				if (oldPath === file.path) {
					return;
				}
				if (file instanceof TFolder) {
					this.queueFolderRename(file, oldPath);
					return;
				}

				this.recordObservedChange({
					type: "rename",
					oldPath,
					newPath: file.path,
				});
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("create", (file) => {
				if (this.destroyed) {
					return;
				}
				if (!(file instanceof TFile)) {
					return;
				}
				this.recordObservedChange({
					type: "create",
					path: file.path,
				});
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("delete", (file) => {
				if (this.destroyed) {
					return;
				}
				if (!(file instanceof TFile)) {
					return;
				}
				this.recordObservedChange({
					type: "delete",
					path: file.path,
				});
			}),
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on("modify", (file) => {
				if (this.destroyed) {
					return;
				}
				if (!(file instanceof TFile)) {
					return;
				}
				if (!isIndexLinkCapableExtension(file.extension)) {
					return;
				}
				this.recordObservedChange({
					type: "modify",
					path: file.path,
				});
			}),
		);
	}

	private recordObservedChange(change: IncrementalFileChange): void {
		this.recordObservedChanges([change]);
	}

	private recordObservedChanges(changes: readonly IncrementalFileChange[]): void {
		if (this.destroyed || changes.length === 0) {
			return;
		}

		if (this.initialFullScanState === "running") {
			for (const change of changes) {
				this.initialChangeRecorder.record(
					change,
					this.metadataResolveGeneration,
				);
			}
			return;
		}

		if (this.initialFullScanState === "failed") {
			for (const change of changes) {
				this.initialChangeRecorder.record(
					change,
					this.metadataResolveGeneration,
				);
			}
			this.retryInitialFullScan();
			return;
		}

		if (this.initialFullScanState === "pending") {
			return;
		}

		this.hasAttemptedAutomaticRecovery = false;
		this.changeQueue.recordChanges(changes);

		const hasMetadataDependentChange = changes.some(
			(change) => change.type === "create" || change.type === "rename",
		);
		if (hasMetadataDependentChange) {
			this.waitsForMetadataResolve = true;
		}

		this.syncMetadataResolveGate();

		if (hasMetadataDependentChange) {
			return;
		}

		this.schedulePendingProcessing();
	}

	private queueFolderRename(folder: TFolder, oldFolderPath: string): void {
		const normalizedFolderPath =
			folder.path.indexOf("\\") === -1 ? folder.path : normalizePath(folder.path);
		const normalizedOldFolderPath =
			oldFolderPath.indexOf("\\") === -1
				? oldFolderPath
				: normalizePath(oldFolderPath);
		const newPrefix =
			normalizedFolderPath.length > 0 ? `${normalizedFolderPath}/` : "";
		const oldPrefix =
			normalizedOldFolderPath.length > 0 ? `${normalizedOldFolderPath}/` : "";
		const newPrefixLength = newPrefix.length;
		const changes: IncrementalFileChange[] = [];

		for (const currentFile of this.plugin.app.vault.getFiles()) {
			if (!isIndexLinkCapableExtension(currentFile.extension)) {
				continue;
			}

			const newFilePath = currentFile.path;
			if (!newFilePath.startsWith(newPrefix)) {
				continue;
			}

			const oldFilePath = `${oldPrefix}${newFilePath.slice(newPrefixLength)}`;
			changes.push({
				type: "rename",
				oldPath: oldFilePath,
				newPath: newFilePath,
			});
		}

		this.recordObservedChanges(changes);
	}

	private async runInitialFullScan(): Promise<void> {
		if (
			this.destroyed ||
			this.initialFullScanState === "running" ||
			this.initialFullScanState === "completed"
		) {
			return;
		}

		this.initialFullScanState = "running";
		let startedAt = 0;
		if (process.env.NODE_ENV === "development") {
			startedAt = performance.now();
		}
		try {
			await this.indexingService.rebuildIndexesTimeSliced();
			if (this.destroyed) {
				return;
			}
			await this.applyInitialCatchUpChanges();
			if (this.destroyed) {
				return;
			}
			this.initialFullScanState = "completed";
			if (process.env.NODE_ENV === "development") {
				const durationMs = performance.now() - startedAt;
				console.info(
					`[IndexUpdateQueue] Initial backlink map built in ${durationMs.toFixed(1)} ms.`,
				);
			}
			this.resolveInitialFullScanReady?.();
			this.resolveInitialFullScanReady = undefined;
		} catch (error) {
			if (!this.destroyed) {
				this.initialFullScanState = "failed";
			}
			throw error;
		} finally {
			this.notifyQueueIdleWaitersIfIdle();
		}
	}

	private retryInitialFullScan(): void {
		if (this.destroyed || this.initialFullScanState !== "failed") {
			return;
		}

		void this.runInitialFullScan().catch((error) => {
			console.error("[IndexUpdateQueue] Initial full scan retry failed:", error);
		});
	}

	private async applyInitialCatchUpChanges(): Promise<void> {
		this.isProcessingPendingChanges = true;
		try {
			while (this.initialChangeRecorder.hasPending()) {
				while (
					this.initialChangeRecorder.needsMetadataResolve(
						this.metadataResolveGeneration,
						(path) => this.fileExists(path),
					)
				) {
					await this.waitForNextMetadataResolve();

					if (this.destroyed) {
						return;
					}
				}

				const changes = this.initialChangeRecorder.drainToFinalStateChanges(
					(path) => this.fileExists(path),
					(path) => this.shouldIndexPath(path),
				);
				if (changes.length > 0) {
					await this.indexingService.applyFileChangesTimeSliced(changes);
				}
			}
		} finally {
			this.isProcessingPendingChanges = false;
			this.notifyQueueIdleWaitersIfIdle();
		}
	}

	private async processPendingChanges(): Promise<void> {
		if (this.destroyed) {
			return;
		}
		if (this.isProcessingPendingChanges) {
			return;
		}

		if (!this.changeQueue.hasPending()) {
			this.syncMetadataResolveGate();
			this.notifyQueueIdleWaitersIfIdle();
			return;
		}

		if (this.shouldDelayForMetadataResolve()) {
			return;
		}

		let shouldScheduleRecovery = false;
		this.isProcessingPendingChanges = true;
		try {
			while (this.changeQueue.hasPending()) {
				if (this.shouldDelayForMetadataResolve()) {
					break;
				}
				if (this.destroyed) {
					break;
				}

				const { changes, requiresFullRebuild } = this.changeQueue.drain();
				this.syncMetadataResolveGate();

				if (requiresFullRebuild) {
					await this.indexingService.rebuildIndexesTimeSliced();
				}

				if (changes.length > 0 && !requiresFullRebuild) {
					await this.indexingService.applyFileChangesTimeSliced(changes);
				}
			}
			if (!this.changeQueue.hasPending()) {
				this.hasAttemptedAutomaticRecovery = false;
			}
		} catch (error) {
			this.changeQueue.requestFullRebuild();
			if (!this.hasAttemptedAutomaticRecovery) {
				this.hasAttemptedAutomaticRecovery = true;
				shouldScheduleRecovery = true;
			}
			throw error;
		} finally {
			this.isProcessingPendingChanges = false;
			this.syncMetadataResolveGate();
			this.notifyQueueIdleWaitersIfIdle();
			if (shouldScheduleRecovery && !this.destroyed) {
				this.schedulePendingProcessing();
			}
		}
	}

	private syncMetadataResolveGate(): void {
		if (!this.changeQueue.hasPendingCreateChanges()) {
			this.waitsForMetadataResolve = false;
		}
	}

	private shouldDelayForMetadataResolve(): boolean {
		return (
			this.waitsForMetadataResolve &&
			this.changeQueue.hasPending() &&
			!this.changeQueue.requiresFullRebuild()
		);
	}

	private schedulePendingProcessing(): void {
		if (this.destroyed) {
			return;
		}
		if (this.shouldDelayForMetadataResolve()) {
			return;
		}
		this.debouncedProcessPending();
	}

	private isQueueIdle(): boolean {
		return (
			!this.isProcessingPendingChanges &&
			!this.changeQueue.hasPending() &&
			!this.initialChangeRecorder.hasPending()
		);
	}

	private notifyQueueIdleWaitersIfIdle(): void {
		if (!this.isQueueIdle() || this.queueIdleWaiters.size === 0) {
			return;
		}

		for (const resolve of this.queueIdleWaiters) {
			resolve();
		}
		this.queueIdleWaiters.clear();
	}

	private handleMetadataResolved(): void {
		this.metadataResolveGeneration++;

		for (const resolve of this.metadataResolveWaiters) {
			resolve();
		}
		this.metadataResolveWaiters.clear();

		if (this.destroyed) {
			return;
		}

		this.waitsForMetadataResolve = false;
		this.debouncedProcessPending();
	}

	private waitForNextMetadataResolve(): Promise<void> {
		return new Promise((resolve) => {
			this.metadataResolveWaiters.add(resolve);
		});
	}

	private fileExists(path: string): boolean {
		return this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile;
	}

	private shouldIndexPath(path: string): boolean {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && isIndexLinkCapableExtension(file.extension);
	}
}
