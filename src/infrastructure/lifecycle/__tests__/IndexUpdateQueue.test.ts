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

	return {
		TFile,
		TFolder,
		WorkspaceLeaf,
		debounce,
		normalizePath,
	};
});

import { TFile } from "obsidian";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
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

	let dataUpdateListener: ((context: DataUpdateContext) => void) | undefined;
	let indexIdleWaiter: (() => Promise<void>) | undefined;
	let indexVersion = 0;

	const indexingService = {
		rebuildIndexesTimeSliced: vi.fn(async () => undefined),
		applyFileChangesTimeSliced: vi.fn(
			async (
				changes: Array<{
					path?: string;
					oldPath?: string;
					newPath?: string;
				}>,
			) => {
				const paths = changes
					.map((c) => c.path ?? c.oldPath ?? c.newPath ?? "")
					.filter(Boolean);
				const lookupKeys = paths.map((p) => p.toLowerCase());
				if (dataUpdateListener) {
					dataUpdateListener({
						indexVersion: ++indexVersion,
						affectedPaths: paths,
						affectedLookupKeys: lookupKeys,
					});
				}
			},
		),
		registerIdleWaiter: vi.fn((waiter: () => Promise<void>) => {
			indexIdleWaiter = waiter;
			return vi.fn();
		}),
		onDataUpdate: vi.fn((listener: (context: DataUpdateContext) => void) => {
			dataUpdateListener = listener;
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

	test("data update context is forwarded to listeners", async () => {
		const harness = createHarness();
		await initializeQueue(harness);
		const listener = vi.fn();
		harness.queue.onDataUpdate(listener);

		harness.emitVaultEvent("modify", createMockTFile("notes/target.md"));
		await flushAsyncTasks();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				affectedPaths: ["notes/target.md"],
				affectedLookupKeys: ["notes/target.md"],
			}),
		);
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
