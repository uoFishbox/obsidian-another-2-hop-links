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

interface Harness {
	queue: IndexUpdateQueue;
	indexingService: {
		rebuildIndexesTimeSliced: ReturnType<typeof vi.fn>;
		applyFileChangesTimeSliced: ReturnType<typeof vi.fn>;
	};
	setVaultFile: (file: TFile) => void;
	removeVaultFile: (path: string) => void;
	triggerLayoutReady: () => void;
	waitForIndexIdle: () => Promise<void>;
	emitVaultEvent: (event: string, ...args: unknown[]) => void;
	emitMetadataEvent: (event: string, ...args: unknown[]) => void;
}

function createHarness(): Harness {
	const vaultHandlers = new Map<string, EventCallback[]>();
	const metadataHandlers = new Map<string, EventCallback[]>();
	const layoutReadyCallbacks: Array<() => void> = [];
	const vaultFiles = new Map<string, TFile>();

	const plugin = {
		app: {
			workspace: {
				onLayoutReady: vi.fn((callback: () => void) => {
					layoutReadyCallbacks.push(callback);
				}),
			},
			metadataCache: {
				on: vi.fn((event: string, callback: EventCallback) => {
					const handlers = metadataHandlers.get(event) ?? [];
					handlers.push(callback);
					metadataHandlers.set(event, handlers);
				}),
			},
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

	const indexingService = {
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
		setVaultFile: (file: TFile) => {
			vaultFiles.set(file.path, file);
		},
		removeVaultFile: (path: string) => {
			vaultFiles.delete(path);
		},
		triggerLayoutReady: () => {
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
	vi.advanceTimersByTime(100);
	await flushAsyncTasks();
	harness.indexingService.rebuildIndexesTimeSliced.mockClear();
	harness.indexingService.applyFileChangesTimeSliced.mockClear();
}

function startInitialScan(harness: Harness): void {
	harness.queue.setupEventListeners();
	harness.triggerLayoutReady();
	vi.advanceTimersByTime(100);
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

	test("create waits for metadata resolved before processing", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const created = createMockTFile("notes/new-note.md");

		harness.emitVaultEvent("create", created);
		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();

		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[{ type: "create", path: "notes/new-note.md" }],
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

		startInitialScan(harness);
		harness.emitVaultEvent("create", temp);
		harness.emitVaultEvent("delete", temp);
		harness.removeVaultFile(temp.path);
		await flushAsyncTasks();

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
		vi.advanceTimersByTime(100);
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();
	});

	test("initial catch-up waits for metadata resolved when created file still exists", async () => {
		const harness = createHarness();
		const created = createMockTFile("notes/new-note.md");

		startInitialScan(harness);
		harness.setVaultFile(created);
		harness.emitVaultEvent("create", created);
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).not.toHaveBeenCalled();

		harness.emitMetadataEvent("resolved");
		await flushAsyncTasks();

		expect(
			harness.indexingService.applyFileChangesTimeSliced,
		).toHaveBeenCalledTimes(1);
		expect(harness.indexingService.applyFileChangesTimeSliced).toHaveBeenCalledWith(
			[{ type: "create", path: "notes/new-note.md" }],
		);
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

		startInitialScan(harness);
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
	});
});
