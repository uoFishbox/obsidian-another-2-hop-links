import { describe, test, expect, vi, beforeEach } from "vitest";
import { PreviewService as PreviewServiceClass } from "../core/createPreviewService";
import type { IVault, IMetadataCache } from "types/obsidian";
import {
	createMockTFileAsPlainObject,
	createMockVault,
} from "testing/__mocks__/testHelpers";
import type { PreviewStrategy, PreviewData } from "../core/PreviewStrategy";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function createMockMetadataCache(): IMetadataCache {
	return {
		getFileCache: vi.fn(),
		getFirstLinkpathDest: vi.fn(),
	} as any;
}

describe("PreviewService queue behavior", () => {
	let vault: IVault;
	let metadataCache: IMetadataCache;

	beforeEach(() => {
		vault = createMockVault();
		metadataCache = createMockMetadataCache();
		vi.clearAllMocks();
	});

	test("queue metrics start at zero", () => {
		const service = new PreviewServiceClass([]);

		expect(service.getVisibleQueueSize()).toBe(0);
		expect(service.getActiveVisiblePreviewCount()).toBe(0);
	});

	test("queue metrics report active and queued visible previews", async () => {
		const deferredByPath = new Map<string, ReturnType<typeof createDeferred<PreviewData>>>();
		const strategy: PreviewStrategy = {
			canHandle: () => true,
			generate: vi.fn((file) => {
				const deferred = createDeferred<PreviewData>();
				deferredByPath.set(file.path, deferred);
				return deferred.promise;
			}),
		};
		const service = new PreviewServiceClass([strategy]);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");

		const firstPromise = service.getPreview(firstFile, vault, metadataCache);
		const secondPromise = service.getPreview(secondFile, vault, metadataCache);

		expect(service.getActiveVisiblePreviewCount()).toBe(1);
		expect(service.getVisibleQueueSize()).toBe(1);

		deferredByPath.get(firstFile.path)?.resolve({
			type: "text",
			content: "first",
		});
		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "first",
		});
		await Promise.resolve();

		expect(service.getActiveVisiblePreviewCount()).toBe(1);
		expect(service.getVisibleQueueSize()).toBe(0);

		deferredByPath.get(secondFile.path)?.resolve({
			type: "text",
			content: "second",
		});
		await expect(secondPromise).resolves.toEqual({
			type: "text",
			content: "second",
		});
		await Promise.resolve();

		expect(service.getActiveVisiblePreviewCount()).toBe(0);
		expect(service.getVisibleQueueSize()).toBe(0);
	});

	test("queue metrics update when a queued visible preview is aborted", async () => {
		const firstDeferred = createDeferred<PreviewData>();
		const strategy: PreviewStrategy = {
			canHandle: () => true,
			generate: vi.fn(() => firstDeferred.promise),
		};
		const service = new PreviewServiceClass([strategy]);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");
		const secondController = new AbortController();

		const firstPromise = service.getPreview(firstFile, vault, metadataCache);
		const secondPromise = service.getPreview(
			secondFile,
			vault,
			metadataCache,
			undefined,
			undefined,
			secondController.signal,
		);

		expect(service.getActiveVisiblePreviewCount()).toBe(1);
		expect(service.getVisibleQueueSize()).toBe(1);

		secondController.abort();
		await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });

		expect(service.getActiveVisiblePreviewCount()).toBe(1);
		expect(service.getVisibleQueueSize()).toBe(0);

		firstDeferred.resolve({ type: "text", content: "first" });
		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "first",
		});
		await Promise.resolve();

		expect(service.getActiveVisiblePreviewCount()).toBe(0);
		expect(service.getVisibleQueueSize()).toBe(0);
	});

	test("shutdown resets queue metrics", () => {
		const strategy: PreviewStrategy = {
			canHandle: () => true,
			generate: vi.fn(() => new Promise<PreviewData>(() => {})),
		};
		const service = new PreviewServiceClass([strategy]);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");

		void service.getPreview(firstFile, vault, metadataCache).catch(() => {});
		void service.getPreview(secondFile, vault, metadataCache).catch(() => {});

		expect(service.getActiveVisiblePreviewCount()).toBe(1);
		expect(service.getVisibleQueueSize()).toBe(1);

		service.shutdown();

		expect(service.getActiveVisiblePreviewCount()).toBe(0);
		expect(service.getVisibleQueueSize()).toBe(0);
	});

	test("already aborted preview is not executed", async () => {
		const strategy: PreviewStrategy = {
			canHandle: () => true,
			generate: vi.fn(async () => ({
				type: "empty" as const,
				content: "generated",
			})),
		};
		const service = new PreviewServiceClass([strategy]);
		const file = createMockTFileAsPlainObject("first.md");
		const controller = new AbortController();
		controller.abort();

		const promise = service.getPreview(
			file,
			vault,
			metadataCache,
			undefined,
			undefined,
			controller.signal,
		);

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(strategy.generate).not.toHaveBeenCalled();
	});

	test("in-flight preview for the same file is shared", async () => {
		const deferred = createDeferred<PreviewData>();
		const strategy: PreviewStrategy = {
			canHandle: () => true,
			generate: vi.fn(() => deferred.promise),
		};
		const service = new PreviewServiceClass([strategy]);
		const file = createMockTFileAsPlainObject("shared.md");
		const firstController = new AbortController();
		const secondController = new AbortController();

		const firstPromise = service.getPreview(
			file,
			vault,
			metadataCache,
			undefined,
			undefined,
			firstController.signal,
		);

		const secondPromise = service.getPreview(
			file,
			vault,
			metadataCache,
			undefined,
			undefined,
			secondController.signal,
		);

		expect(strategy.generate).toHaveBeenCalledTimes(1);

		secondController.abort();
		deferred.resolve({ type: "text", content: "shared" });

		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "shared",
		});
		await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });
	});

	test("shutdown aborts in-flight requests", async () => {
		const strategy: PreviewStrategy = {
			canHandle: () => true,
			generate: vi.fn((_file, _context, signal): Promise<PreviewData> => {
				return new Promise<PreviewData>((_, reject) => {
					const onAbort = () => {
						reject(
							new DOMException(
								"Preview request aborted",
								"AbortError",
							),
						);
					};
					if (signal?.aborted) {
						onAbort();
						return;
					}
					signal?.addEventListener("abort", onAbort, { once: true });
				});
			}),
		};
		const service = new PreviewServiceClass([strategy]);
		const file = createMockTFileAsPlainObject("visible.md");

		const request = service.getPreview(
			file,
			vault,
			metadataCache,
		);

		await Promise.resolve();
		expect(strategy.generate).toHaveBeenCalledTimes(1);

		service.shutdown();

		await expect(request).rejects.toMatchObject({ name: "AbortError" });
	});
});
