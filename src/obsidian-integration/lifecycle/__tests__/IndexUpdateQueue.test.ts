import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("obsidian", () => {
	class TFile {
		path = "";
		extension = "md";
	}

	class TFolder {
		path = "";
	}

	class WorkspaceLeaf {}

	function debounce<T extends (...args: never[]) => void>(
		fn: T,
		_delay: number,
		_immediate?: boolean,
	): (...args: Parameters<T>) => ReturnType<T> {
		return (...args: Parameters<T>) => fn(...args) as ReturnType<T>;
	}

	function normalizePath(path: string): string {
		return path
			.replace(/\\/g, "/")
			.replace(/\/+/g, "/")
			.replace(/^\/+|\/+$/g, "");
	}

	function getLinkpath(linkText: string): string {
		return linkText.split(/[#^]/, 1)[0] ?? "";
	}

	return {
		TFile,
		TFolder,
		WorkspaceLeaf,
		debounce,
		getLinkpath,
		normalizePath,
	};
});

import { TFile, TFolder } from "obsidian";
import type { DataUpdateContext } from "indexing/index-service/IndexEvents";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { IndexUpdateQueue } from "../IndexUpdateQueue";

type EventCallback = (...args: unknown[]) => void;
const INITIAL_FULL_SCAN_DELAY_MS = 100;

interface Harness {
	queue: IndexUpdateQueue;
	indexingService: {
		beginStagedRebuild: ReturnType<typeof vi.fn>;
		rebuildIndexesTimeSliced: ReturnType<typeof vi.fn>;
		applyFileChangesTimeSliced: ReturnType<typeof vi.fn>;
	};
	stagedRebuilds: Array<{
		commit: ReturnType<typeof vi.fn>;
		discard: ReturnType<typeof vi.fn>;
	}>;
	setVaultFile: (file: TFile) => void;
	removeVaultFile: (path: string) => void;
	triggerLayoutReady: () => void;
	waitForIndexIdle: () => Promise<void>;
	emitVaultEvent: (event: string, ...args: unknown[]) => void;
	emitMetadataEvent: (event: string, ...args: unknown[]) => void;
}

interface HarnessOptions {
	readonly layoutAlreadyReady?: boolean;
}

function createHarness(options: HarnessOptions = {}): Harness {
	const vaultHandlers = new Map<string, EventCallback[]>();
	const metadataHandlers = new Map<string, EventCallback[]>();
	const layoutReadyCallbacks: Array<() => void> = [];
	const vaultFiles = new Map<string, TFile>();
	let layoutReady = options.layoutAlreadyReady ?? false;
	const metadataCache = {
		on: vi.fn((event: string, callback: EventCallback) => {
			const handlers = metadataHandlers.get(event) ?? [];
			handlers.push(callback);
			metadataHandlers.set(event, handlers);
		}),
	};

	const plugin = {
		app: {
			workspace: {
				get layoutReady(): boolean {
					return layoutReady;
				},
				onLayoutReady: vi.fn((callback: () => void) => {
					if (layoutReady) {
						callback();
						return;
					}
					layoutReadyCallbacks.push(callback);
				}),
			},
			metadataCache,
			vault: {
				on: vi.fn((event: string, callback: EventCallback) => {
					const handlers = vaultHandlers.get(event) ?? [];
					handlers.push(callback);
					vaultHandlers.set(event, handlers);
				}),
				getFiles: vi.fn(() => [...vaultFiles.values()]),
				getAbstractFileByPath: vi.fn(
					(path: string) => vaultFiles.get(path) ?? null,
				),
			},
		},
		registerEvent: vi.fn((eventRef: unknown) => eventRef),
	};

	let indexIdleWaiter: (() => Promise<void>) | undefined;
	const stagedRebuilds: Harness["stagedRebuilds"] = [];

	const indexingService = {
		beginStagedRebuild: vi.fn(() => {
			const stagedRebuild = {
				commit: vi.fn(),
				discard: vi.fn(),
			};
			stagedRebuilds.push(stagedRebuild);
			return stagedRebuild;
		}),
		rebuildIndexesTimeSliced: vi.fn(async () => undefined),
		applyFileChangesTimeSliced: vi.fn(async () => undefined),
		registerIdleWaiter: vi.fn((waiter: () => Promise<void>) => {
			indexIdleWaiter = waiter;
			return vi.fn();
		}),
	};

	const queue = new IndexUpdateQueue(plugin as never, indexingService as never);

	return {
		queue,
		indexingService,
		stagedRebuilds,
		setVaultFile: (file: TFile) => {
			vaultFiles.set(file.path, file);
		},
		removeVaultFile: (path: string) => {
			vaultFiles.delete(path);
		},
		triggerLayoutReady: () => {
			layoutReady = true;
			for (const callback of layoutReadyCallbacks) {
				callback();
			}
		},
		waitForIndexIdle: async () => {
			await indexIdleWaiter?.();
		},
		emitVaultEvent: (event: string, ...args: unknown[]) => {
			const handlers = vaultHandlers.get(event) ?? [];
			for (const handler of handlers) {
				handler(...args);
			}
		},
		emitMetadataEvent: (event: string, ...args: unknown[]) => {
			const handlers = metadataHandlers.get(event) ?? [];
			for (const handler of handlers) {
				handler(...args);
			}
		},
	};
}

async function flushAsyncTasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

async function initializeQueue(harness: Harness): Promise<void> {
	harness.queue.setupEventListeners();
	harness.triggerLayoutReady();
	await vi.advanceTimersByTimeAsync(INITIAL_FULL_SCAN_DELAY_MS);
	await flushAsyncTasks();
	await harness.waitForIndexIdle();
	harness.indexingService.rebuildIndexesTimeSliced.mockClear();
	harness.indexingService.applyFileChangesTimeSliced.mockClear();
}

async function startInitialScan(harness: Harness): Promise<void> {
	harness.queue.setupEventListeners();
	harness.triggerLayoutReady();
	await vi.advanceTimersByTimeAsync(INITIAL_FULL_SCAN_DELAY_MS);
	await flushAsyncTasks();
}

describe("IndexUpdateQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", {
			setTimeout,
			clearTimeout,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	test("initial scan starts 100 ms after layout ready without waiting for cache clean", async () => {
		const harness = createHarness();

		harness.queue.setupEventListeners();
		harness.triggerLayoutReady();
		await flushAsyncTasks();
		let becameIdle = false;
		const idlePromise = harness.waitForIndexIdle().then(() => {
			becameIdle = true;
		});
		await flushAsyncTasks();

		expect(harness.indexingService.rebuildIndexesTimeSliced).not.toHaveBeenCalled();
		expect(becameIdle).toBe(false);

		harness.emitMetadataEvent("resolved");
		await vi.advanceTimersByTimeAsync(INITIAL_FULL_SCAN_DELAY_MS - 1);
		expect(harness.indexingService.rebuildIndexesTimeSliced).not.toHaveBeenCalled();
		expect(becameIdle).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		await flushAsyncTasks();
		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			1,
		);
		await idlePromise;

		expect(becameIdle).toBe(true);
	});

	test("metadata activity before the scheduled scan does not postpone it", async () => {
		const harness = createHarness();

		harness.queue.setupEventListeners();
		harness.triggerLayoutReady();
		await vi.advanceTimersByTimeAsync(INITIAL_FULL_SCAN_DELAY_MS - 1);

		harness.emitMetadataEvent("resolved");
		await vi.advanceTimersByTimeAsync(1);
		await flushAsyncTasks();

		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			1,
		);
	});

	test("initial scan keeps the 100 ms delay when layout is already ready", async () => {
		const harness = createHarness({ layoutAlreadyReady: true });

		harness.queue.setupEventListeners();
		await vi.advanceTimersByTimeAsync(INITIAL_FULL_SCAN_DELAY_MS - 1);
		expect(harness.indexingService.rebuildIndexesTimeSliced).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await flushAsyncTasks();

		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			1,
		);
	});

	test("create waits for metadata resolved before processing", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const created = createMockTFile("notes/new-note.md");
		const resolvedSource = createMockTFile("notes/existing-source.md");

		harness.emitVaultEvent("create", created);
		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();

		harness.emitMetadataEvent("resolve", resolvedSource);
		harness.emitMetadataEvent("resolve", resolvedSource);
		harness.emitMetadataEvent("resolve", created);
		harness.emitMetadataEvent(
			"resolve",
			createMockTFile("attachments/image.png", "png"),
		);
		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[
				{ type: "create", path: "notes/new-note.md" },
				{ type: "resolve", path: "notes/existing-source.md" },
			],
		);
	});

	test("modify is processed immediately without waiting for metadata", async () => {
		const harness = createHarness();
		await initializeQueue(harness);

		harness.emitVaultEvent("modify", createMockTFile("notes/existing.md"));
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[{ type: "modify", path: "notes/existing.md" }],
		);
	});

	test("markdown metadata change repairs an index update that used stale metadata", async () => {
		const environment = new VaultEnvironmentBuilder([
			{ path: "origin.md", links: [] },
			{ path: "target.md" },
		]).build();
		const harness = createHarness();
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementation(() =>
			environment.service.rebuildIndexesTimeSliced(),
		);
		harness.indexingService.applyFileChangesTimeSliced.mockImplementation(
			(changes) => environment.service.applyFileChangesTimeSliced(changes),
		);
		await initializeQueue(harness);
		await harness.waitForIndexIdle();
		const contexts: DataUpdateContext[] = [];
		environment.service.onDataUpdate((context) => contexts.push(context));
		const staleOrigin = environment.mockVault.getAbstractFileByPath(
			"origin.md",
		) as TFile;

		harness.emitVaultEvent("modify", staleOrigin);
		await harness.queue.awaitQueueIdle();

		expect(contexts).toHaveLength(1);
		expect(contexts[0]?.affectedLinkSourcePaths).toEqual([]);
		expect(environment.service.getBacklinksForLink("target.md")).toEqual([]);

		environment.builder.addFile({ path: "origin.md", links: ["target"] });
		const currentOrigin = environment.mockVault.getAbstractFileByPath(
			"origin.md",
		) as TFile;
		harness.emitMetadataEvent("changed", currentOrigin);
		await harness.queue.awaitQueueIdle();

		expect(contexts).toHaveLength(2);
		expect(contexts[1]?.affectedLinkSourcePaths).toEqual(["origin.md"]);
		expect(
			environment.service
				.getBacklinksForLink("target.md")
				.map((link) => link.sourceFile.path),
		).toEqual(["origin.md"]);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[{ type: "modify", path: "origin.md" }],
		);
	});

	test("metadata change ignores files that cannot contain indexed links", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const attachment = createMockTFile("attachments/image.png", "png");

		harness.emitMetadataEvent("changed", attachment);
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
	});

	test("per-file resolution does not schedule an index update", async () => {
		const harness = createHarness();
		await initializeQueue(harness);

		harness.emitMetadataEvent(
			"resolve",
			createMockTFile("notes/resolved-source.md"),
		);
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
	});

	test("initial scan includes parsed metadata added before its scheduled start", async () => {
		const environment = new VaultEnvironmentBuilder([
			{ path: "first-source.md", links: ["missing"] },
			{ path: "second-source.md", links: [] },
		]).build();
		const harness = createHarness();
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementation(() =>
			environment.service.rebuildIndexesTimeSliced(),
		);
		harness.indexingService.applyFileChangesTimeSliced.mockImplementation(
			(changes) => environment.service.applyFileChangesTimeSliced(changes),
		);
		harness.queue.setupEventListeners();
		harness.triggerLayoutReady();
		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();
		expect(harness.indexingService.rebuildIndexesTimeSliced).not.toHaveBeenCalled();

		environment.builder.addFile({
			path: "second-source.md",
			links: ["missing"],
		});
		await vi.advanceTimersByTimeAsync(INITIAL_FULL_SCAN_DELAY_MS);
		await flushAsyncTasks();
		await harness.waitForIndexIdle();

		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			1,
		);
		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
		expect(environment.service.getBacklinkCountForLink("missing.md")).toBe(2);
	});

	test("folder rename batches descendant changes behind one metadata gate", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const firstFile = createMockTFile("new-folder/first.md");
		const secondFile = createMockTFile("new-folder/second.md");
		harness.setVaultFile(firstFile);
		harness.setVaultFile(secondFile);
		const folder = new TFolder();
		folder.path = "new-folder";

		harness.emitVaultEvent("rename", folder, "old-folder");
		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();

		harness.emitMetadataEvent(
			"resolve",
			createMockTFile("notes/linking-source.md"),
		);
		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[
				{
					type: "rename",
					oldPath: "old-folder/first.md",
					newPath: "new-folder/first.md",
				},
				{
					type: "rename",
					oldPath: "old-folder/second.md",
					newPath: "new-folder/second.md",
				},
				{ type: "resolve", path: "notes/linking-source.md" },
			],
		);
	});

	test("delete is processed immediately without waiting for metadata", async () => {
		const harness = createHarness();
		await initializeQueue(harness);

		harness.emitVaultEvent("delete", createMockTFile("notes/old.md"));
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[{ type: "delete", path: "notes/old.md" }],
		);
	});

	test("incremental update failure recovers with a full rebuild", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const error = new Error("temporary incremental update failure");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		harness.indexingService.applyFileChangesTimeSliced.mockRejectedValueOnce(error);

		harness.emitVaultEvent("delete", createMockTFile("notes/deleted.md"));
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			1,
		);
		expect(consoleError).toHaveBeenCalledWith(
			"[IndexUpdateQueue] Failed to process pending changes:",
			error,
		);
	});

	test("failed recovery rebuild remains pending until the next change", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const applyError = new Error("incremental update failure");
		const rebuildError = new Error("recovery rebuild failure");
		vi.spyOn(console, "error").mockImplementation(() => {});
		harness.indexingService.applyFileChangesTimeSliced.mockRejectedValueOnce(
			applyError,
		);
		harness.indexingService.rebuildIndexesTimeSliced.mockRejectedValueOnce(
			rebuildError,
		);

		harness.emitVaultEvent("delete", createMockTFile("notes/deleted.md"));
		await flushAsyncTasks();

		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			1,
		);

		harness.emitVaultEvent("modify", createMockTFile("notes/next.md"));
		await flushAsyncTasks();

		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			2,
		);
		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
	});

	test("initial catch-up applies delete for a file created and deleted during initial scan", async () => {
		const harness = createHarness();
		const temp = createMockTFile("notes/temp.md");
		let finishInitialScan: (() => void) | undefined;
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishInitialScan = resolve;
				}),
		);

		await startInitialScan(harness);
		harness.emitVaultEvent("create", temp);
		harness.emitVaultEvent("delete", temp);
		harness.removeVaultFile(temp.path);
		finishInitialScan?.();
		await flushAsyncTasks();
		await harness.waitForIndexIdle();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[{ type: "delete", path: "notes/temp.md" }],
		);
	});

	test("initial catch-up ignores events observed before initial full scan starts", async () => {
		const harness = createHarness();
		const preScanFile = createMockTFile("notes/pre-scan.md");

		harness.queue.setupEventListeners();
		harness.emitVaultEvent("modify", preScanFile);
		harness.triggerLayoutReady();
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
	});

	test("initial catch-up waits for metadata resolved when created file still exists", async () => {
		const harness = createHarness();
		const created = createMockTFile("notes/new-note.md");
		const linkingSource = createMockTFile("notes/linking-source.md");
		let finishInitialScan: (() => void) | undefined;
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishInitialScan = resolve;
				}),
		);

		await startInitialScan(harness);
		harness.setVaultFile(created);
		harness.setVaultFile(linkingSource);
		harness.emitVaultEvent("create", created);
		finishInitialScan?.();
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();

		harness.emitMetadataEvent("resolve", linkingSource);
		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();
		await harness.waitForIndexIdle();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[
				{ type: "create", path: "notes/new-note.md" },
				{ type: "resolve", path: "notes/linking-source.md" },
			],
		);
	});

	test("initial scan ignores startup resolves without a create or rename", async () => {
		const harness = createHarness();
		const firstSource = createMockTFile("notes/first-source.md");
		const secondSource = createMockTFile("notes/second-source.md");
		let finishInitialScan: (() => void) | undefined;
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishInitialScan = resolve;
				}),
		);

		await startInitialScan(harness);
		harness.setVaultFile(firstSource);
		harness.setVaultFile(secondSource);
		harness.emitMetadataEvent("resolve", firstSource);
		harness.emitMetadataEvent("resolve", secondSource);
		harness.emitMetadataEvent("resolve", firstSource);
		finishInitialScan?.();
		await flushAsyncTasks();
		await harness.waitForIndexIdle();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
		expect(harness.stagedRebuilds[0]?.commit).toHaveBeenCalledTimes(1);

		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
		expect(harness.stagedRebuilds[0]?.commit).toHaveBeenCalledTimes(1);
	});

	test("initial catch-up normalizes modify and rename after the scan", async () => {
		const harness = createHarness();
		const modified = createMockTFile("notes/modified.md");
		const renamed = createMockTFile("notes/new-name.md");
		let finishInitialScan: (() => void) | undefined;
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishInitialScan = resolve;
				}),
		);

		await startInitialScan(harness);
		harness.setVaultFile(modified);
		harness.setVaultFile(renamed);
		harness.emitVaultEvent("modify", modified);
		harness.emitVaultEvent("rename", renamed, "notes/old-name.md");
		finishInitialScan?.();
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();

		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();
		await harness.waitForIndexIdle();

		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[
				{ type: "modify", path: "notes/modified.md" },
				{ type: "delete", path: "notes/old-name.md" },
				{ type: "create", path: "notes/new-name.md" },
			],
		);
		expect(harness.stagedRebuilds[0]?.commit).toHaveBeenCalledTimes(1);
	});

	test("initial scan failure retries on the next change and keeps readiness pending", async () => {
		const harness = createHarness();
		const error = new Error("temporary read failure");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		let rejectInitialScan: ((error: Error) => void) | undefined;
		harness.indexingService.rebuildIndexesTimeSliced.mockImplementationOnce(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectInitialScan = reject;
				}),
		);

		await startInitialScan(harness);
		const changedDuringFailure = createMockTFile("notes/during-failure.md");
		harness.setVaultFile(changedDuringFailure);
		harness.emitVaultEvent("modify", changedDuringFailure);
		rejectInitialScan?.(error);
		await flushAsyncTasks();

		let ready = false;
		const readiness = harness.waitForIndexIdle().then(() => {
			ready = true;
		});
		await flushAsyncTasks();
		expect(ready).toBe(false);

		const modified = createMockTFile("notes/retry.md");
		harness.setVaultFile(modified);
		harness.emitVaultEvent("modify", modified);
		await flushAsyncTasks();
		await readiness;

		expect(harness.indexingService.rebuildIndexesTimeSliced).toHaveBeenCalledTimes(
			2,
		);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[
				{ type: "modify", path: "notes/during-failure.md" },
				{ type: "modify", path: "notes/retry.md" },
			],
		);
		expect(ready).toBe(true);
		expect(consoleError).toHaveBeenCalledWith(
			"[IndexUpdateQueue] Initial full scan failed:",
			error,
		);
		expect(harness.stagedRebuilds[0]?.commit).not.toHaveBeenCalled();
		expect(harness.stagedRebuilds[0]?.discard).toHaveBeenCalledTimes(1);
		expect(harness.stagedRebuilds[1]?.commit).toHaveBeenCalledTimes(1);
	});
});
