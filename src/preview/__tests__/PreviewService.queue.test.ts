import { describe, test, expect, vi, beforeEach } from "vitest";
import {
	createPreviewService,
	type DisposablePreviewService,
	type PreviewResolver,
} from "../pipeline/createPreviewService";
import type { IVault, IMetadataCache } from "obsidian-integration/hostContracts";
import {
	createMockTFileAsPlainObject,
	createMockVault,
} from "testing/__mocks__/testHelpers";
import type { PreviewData } from "../types";
import { DEFAULT_SETTINGS } from "settings/model";

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

	function createService(resolvePreview?: PreviewResolver): DisposablePreviewService {
		return createPreviewService(
			{
				vault,
				metadataCache,
				app: { workspace: {} } as any,
				getSettings: () => DEFAULT_SETTINGS,
			},
			resolvePreview,
		);
	}

	function expectQueue(
		service: DisposablePreviewService,
		queued: number,
		active: number,
	): void {
		let current = { queued: -1, active: -1 };
		const unsubscribe = service.subscribeVisiblePreviewQueue((snapshot) => {
			current = snapshot;
		});
		unsubscribe();
		expect(current).toEqual({ queued, active });
		expect(service.getOutstandingVisiblePreviewCount()).toBe(queued + active);
	}

	beforeEach(() => {
		vault = createMockVault();
		metadataCache = createMockMetadataCache();
		vi.clearAllMocks();
	});

	test("queue metrics start at zero", () => {
		const service = createService();

		expectQueue(service, 0, 0);
	});

	test("queue metrics report active and queued visible previews", async () => {
		const deferredByPath = new Map<
			string,
			ReturnType<typeof createDeferred<PreviewData>>
		>();
		const resolvePreview = vi.fn<PreviewResolver>((file) => {
			const deferred = createDeferred<PreviewData>();
			deferredByPath.set(file.path, deferred);
			return deferred.promise;
		});
		const service = createService(resolvePreview);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");

		const firstPromise = service.getPreview(firstFile);
		const secondPromise = service.getPreview(secondFile);

		expectQueue(service, 1, 1);

		deferredByPath.get(firstFile.path)?.resolve({
			type: "text",
			content: "first",
		});
		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "first",
		});
		await Promise.resolve();

		expectQueue(service, 0, 1);

		deferredByPath.get(secondFile.path)?.resolve({
			type: "text",
			content: "second",
		});
		await expect(secondPromise).resolves.toEqual({
			type: "text",
			content: "second",
		});
		await Promise.resolve();

		expectQueue(service, 0, 0);
	});

	test("queue metrics update when a queued visible preview is aborted", async () => {
		const firstDeferred = createDeferred<PreviewData>();
		const resolvePreview = vi.fn<PreviewResolver>(() => firstDeferred.promise);
		const service = createService(resolvePreview);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");
		const secondController = new AbortController();

		const firstPromise = service.getPreview(firstFile);
		const secondPromise = service.getPreview(secondFile, secondController.signal);

		expectQueue(service, 1, 1);

		secondController.abort();
		await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });

		expectQueue(service, 0, 1);

		firstDeferred.resolve({ type: "text", content: "first" });
		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "first",
		});
		await Promise.resolve();

		expectQueue(service, 0, 0);
	});

	test("dispose resets queue metrics", () => {
		const resolvePreview = vi.fn<PreviewResolver>(
			() => new Promise<PreviewData>(() => {}),
		);
		const service = createService(resolvePreview);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");

		void service.getPreview(firstFile).catch(() => {});
		void service.getPreview(secondFile).catch(() => {});

		expectQueue(service, 1, 1);

		service.dispose();

		expectQueue(service, 0, 0);
	});

	test("already aborted preview is not executed", async () => {
		const resolvePreview = vi.fn<PreviewResolver>(async () => ({
			type: "empty" as const,
			content: "generated",
		}));
		const service = createService(resolvePreview);
		const file = createMockTFileAsPlainObject("first.md");
		const controller = new AbortController();
		controller.abort();

		const promise = service.getPreview(file, controller.signal);

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(resolvePreview).not.toHaveBeenCalled();
	});

	test("in-flight preview for the same file is shared", async () => {
		const deferred = createDeferred<PreviewData>();
		const resolvePreview = vi.fn<PreviewResolver>(() => deferred.promise);
		const service = createService(resolvePreview);
		const file = createMockTFileAsPlainObject("shared.md");
		const firstController = new AbortController();
		const secondController = new AbortController();

		const firstPromise = service.getPreview(file, firstController.signal);

		const secondPromise = service.getPreview(file, secondController.signal);

		expect(resolvePreview).toHaveBeenCalledTimes(1);

		secondController.abort();
		deferred.resolve({ type: "text", content: "shared" });

		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "shared",
		});
		await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });
	});

	test("dispose aborts in-flight requests", async () => {
		const resolvePreview = vi.fn<PreviewResolver>(
			(_file, _context, signal): Promise<PreviewData> => {
				return new Promise<PreviewData>((_, reject) => {
					const onAbort = () => {
						reject(
							new DOMException("Preview request aborted", "AbortError"),
						);
					};
					if (signal?.aborted) {
						onAbort();
						return;
					}
					signal?.addEventListener("abort", onAbort, { once: true });
				});
			},
		);
		const service = createService(resolvePreview);
		const file = createMockTFileAsPlainObject("visible.md");

		const request = service.getPreview(file);

		await Promise.resolve();
		expect(resolvePreview).toHaveBeenCalledTimes(1);

		service.dispose();

		await expect(request).rejects.toMatchObject({ name: "AbortError" });
	});

	test("queue subscribers receive capacity changes", async () => {
		const deferredByPath = new Map<
			string,
			ReturnType<typeof createDeferred<PreviewData>>
		>();
		const resolvePreview = vi.fn<PreviewResolver>((file) => {
			const deferred = createDeferred<PreviewData>();
			deferredByPath.set(file.path, deferred);
			return deferred.promise;
		});
		const service = createService(resolvePreview);
		const snapshots: Array<{ queued: number; active: number }> = [];
		const unsubscribe = service.subscribeVisiblePreviewQueue((snapshot) => {
			snapshots.push(snapshot);
		});
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");

		const firstPromise = service.getPreview(firstFile);
		const secondPromise = service.getPreview(secondFile);
		expect(snapshots).toContainEqual({ queued: 1, active: 1 });

		deferredByPath.get(firstFile.path)?.resolve({
			type: "text",
			content: "first",
		});
		await firstPromise;
		await Promise.resolve();
		expect(snapshots).toContainEqual({ queued: 0, active: 1 });

		deferredByPath.get(secondFile.path)?.resolve({
			type: "text",
			content: "second",
		});
		await secondPromise;
		await Promise.resolve();
		expect(snapshots.at(-1)).toEqual({ queued: 0, active: 0 });

		unsubscribe();
	});
});
