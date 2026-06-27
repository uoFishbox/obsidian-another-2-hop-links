import { TFile, TFolder, debounce, normalizePath } from "obsidian";
import {
	PLUGIN_NAME,
	INDEXING_DEBOUNCE_DELAY,
	INDEX_LINK_CAPABLE_EXTENSIONS,
} from "../../appConstants";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { IncrementalFileChange } from "core/indexing/types/IndexTypes";
import { FileChangeQueue } from "core/indexing/index-service/FileChangeQueue";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { PluginHost } from "types/pluginHost";
import { enableLogging, logger } from "utils/logger";
import { InitialScanChangeRecorder } from "./InitialScanChangeRecorder";

export type DataUpdateListener = (context: DataUpdateContext) => void;

export class IndexUpdateQueue {
	private dataUpdateListeners: Set<DataUpdateListener> = new Set();
	private debouncedProcessPending: () => void;
	private readonly changeQueue = new FileChangeQueue();
	private readonly initialChangeRecorder = new InitialScanChangeRecorder();
	private readonly queueIdleWaiters: Set<() => void> = new Set();
	private readonly metadataResolveWaiters: Set<() => void> = new Set();
	private readonly initialFullScanReady: Promise<void>;
	private resolveInitialFullScanReady: (() => void) | undefined;
	private initialFullScanTimer: number | undefined;
	private unsubscribeIndexIdleWaiter: (() => void) | undefined;
	private unsubscribeIndexDataUpdate: (() => void) | undefined;
	private isProcessingPendingChanges = false;
	private hasInitialFullScanCompleted = false;
	private isCapturingInitialChanges = false;
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
			INDEXING_DEBOUNCE_DELAY,
			true,
		);
		this.unsubscribeIndexIdleWaiter = this.indexingService.registerIdleWaiter(
			async () => {
				await this.awaitQueueIdle();
				await this.initialFullScanReady;
			},
		);
		this.unsubscribeIndexDataUpdate = this.indexingService.onDataUpdate(
			(context) => {
				this.notifyDataUpdate(context);
			},
		);
	}

	public destroy(): void {
		this.destroyed = true;
		this.unsubscribeIndexIdleWaiter?.();
		this.unsubscribeIndexIdleWaiter = undefined;
		this.unsubscribeIndexDataUpdate?.();
		this.unsubscribeIndexDataUpdate = undefined;
		if (this.initialFullScanTimer !== undefined) {
			window.clearTimeout(this.initialFullScanTimer);
			this.initialFullScanTimer = undefined;
		}
		(this.debouncedProcessPending as { cancel?: () => void }).cancel?.();
		this.dataUpdateListeners.clear();
		this.queueIdleWaiters.forEach((resolve) => resolve());
		this.queueIdleWaiters.clear();
		this.metadataResolveWaiters.forEach((resolve) => resolve());
		this.metadataResolveWaiters.clear();
		this.resolveInitialFullScanReady?.();
		this.resolveInitialFullScanReady = undefined;
	}

	public onDataUpdate(listener: DataUpdateListener): () => void {
		this.dataUpdateListeners.add(listener);
		return () => {
			this.dataUpdateListeners.delete(listener);
		};
	}

	private notifyDataUpdate(context: DataUpdateContext): void {
		if (this.destroyed) {
			return;
		}
		this.dataUpdateListeners.forEach((listener) => {
			try {
				listener(context);
			} catch (error) {
				console.error("Error in data update listener:", error);
			}
		});
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
		if (enableLogging) logger(`[EventManager] Index update requested for: ${path}`);
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
				if (file instanceof TFile && file.extension === "canvas") {
					if (enableLogging)
						logger(
							`[EventManager] Canvas ${file.path}: Link structure changed, queueing index update`,
						);
					this.recordObservedChange({
						type: "modify",
						path: file.path,
					});
				}
			}),
		);
	}

	private registerVaultListeners(): void {
		if (this.destroyed) {
			return;
		}
		if (enableLogging)
			logger("[EventManager] Registering vault file system listeners");

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
					if (enableLogging)
						logger(
							`[EventManager] Folder renamed: ${oldPath} -> ${file.path}, queueing descendant rename events`,
						);
					this.queueFolderRename(file, oldPath);
					return;
				}

				if (enableLogging)
					logger(
						`[EventManager] File renamed: ${oldPath} -> ${file.path}, queueing rename event`,
					);
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
				if (enableLogging)
					logger(
						`[EventManager] File created: ${file.path}, queueing create event`,
					);
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
				if (!INDEX_LINK_CAPABLE_EXTENSIONS.has(file.extension.toLowerCase())) {
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
		if (this.destroyed) {
			return;
		}

		if (this.isCapturingInitialChanges) {
			this.initialChangeRecorder.record(change, this.metadataResolveGeneration);
			return;
		}

		if (!this.hasInitialFullScanCompleted) {
			return;
		}

		this.changeQueue.recordChange(change);

		if (change.type === "create" || change.type === "rename") {
			this.waitsForMetadataResolve = true;
		}

		this.syncMetadataResolveGate();

		if (change.type === "create" || change.type === "rename") {
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

		for (const currentFile of this.plugin.app.vault.getFiles()) {
			if (
				!INDEX_LINK_CAPABLE_EXTENSIONS.has(currentFile.extension.toLowerCase())
			) {
				continue;
			}

			const newFilePath = currentFile.path;
			if (!newFilePath.startsWith(newPrefix)) {
				continue;
			}

			const oldFilePath = `${oldPrefix}${newFilePath.slice(newPrefixLength)}`;
			this.recordObservedChange({
				type: "rename",
				oldPath: oldFilePath,
				newPath: newFilePath,
			});
		}
	}

	private async runInitialFullScan(): Promise<void> {
		try {
			if (this.destroyed) {
				return;
			}
			this.isCapturingInitialChanges = true;
			await this.indexingService.rebuildIndexesTimeSliced();
			if (this.destroyed) {
				return;
			}
			await this.applyInitialCatchUpChanges();
			if (this.destroyed) {
				return;
			}
			if (enableLogging)
				logger(`${PLUGIN_NAME}: Detailed backlinks map built (Initial)`);
		} finally {
			this.resolveInitialFullScanReady?.();
			this.resolveInitialFullScanReady = undefined;
			if (this.isCapturingInitialChanges) {
				this.initialChangeRecorder.clear();
				this.isCapturingInitialChanges = false;
			}
			this.notifyQueueIdleWaitersIfIdle();
		}
	}

	private async applyInitialCatchUpChanges(): Promise<void> {
		if (!this.initialChangeRecorder.hasPending()) {
			if (enableLogging) {
				logger(
					"[IndexUpdateQueue] Initial catch-up: no changes after full scan",
				);
			}
			this.isCapturingInitialChanges = false;
			this.hasInitialFullScanCompleted = true;
			return;
		}

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

		if (enableLogging) {
			logger(
				`[IndexUpdateQueue] Initial catch-up: applying ${changes.length} changes after full scan`,
			);
		}

		this.isProcessingPendingChanges = true;
		this.isCapturingInitialChanges = false;
		this.hasInitialFullScanCompleted = true;

		try {
			if (changes.length > 0) {
				await this.indexingService.applyFileChangesTimeSliced(changes);
			}
			if (enableLogging) {
				logger("[IndexUpdateQueue] Initial catch-up: complete");
			}
		} finally {
			this.isProcessingPendingChanges = false;
			this.notifyQueueIdleWaitersIfIdle();
		}

		this.schedulePendingProcessing();
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

		this.isProcessingPendingChanges = true;
		try {
			while (this.changeQueue.hasPending()) {
				if (this.shouldDelayForMetadataResolve()) {
					break;
				}
				if (this.destroyed) {
					break;
				}

				const { changes, requiresBacklinkRebuild, requiresTagRebuild } =
					this.changeQueue.drain();
				this.syncMetadataResolveGate();

				const needsFullRebuild = requiresBacklinkRebuild || requiresTagRebuild;

				if (needsFullRebuild) {
					await this.indexingService.rebuildIndexesTimeSliced();
				}

				if (changes.length > 0 && !needsFullRebuild) {
					await this.indexingService.applyFileChangesTimeSliced(changes);
				}
			}
		} finally {
			this.isProcessingPendingChanges = false;
			this.syncMetadataResolveGate();
			this.notifyQueueIdleWaitersIfIdle();
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
		return (
			file instanceof TFile &&
			INDEX_LINK_CAPABLE_EXTENSIONS.has(file.extension.toLowerCase())
		);
	}
}
