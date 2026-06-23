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
	triggerLayoutReady: () => void;
	emitVaultEvent: (event: string, ...args: unknown[]) => void;
	emitMetadataEvent: (event: string, ...args: unknown[]) => void;
}

function createHarness(): Harness {
	const vaultHandlers = new Map<string, EventCallback[]>();
	const metadataHandlers = new Map<string, EventCallback[]>();
	const layoutReadyCallbacks: Array<() => void> = [];

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
				getFiles: vi.fn(() => [] as TFile[]),
			},
		},
		registerEvent: vi.fn((eventRef: unknown) => eventRef),
	};

	let dataUpdateListener: ((context: DataUpdateContext) => void) | undefined;
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
		registerIdleWaiter: vi.fn(() => vi.fn()),
		onDataUpdate: vi.fn((listener: (context: DataUpdateContext) => void) => {
			dataUpdateListener = listener;
			return vi.fn();
		}),
	};

	const queue = new IndexUpdateQueue(plugin as never, indexingService as never);

	return {
		queue,
		indexingService,
		triggerLayoutReady: () => {
			for (const callback of layoutReadyCallbacks) {
				callback();
			}
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
});
