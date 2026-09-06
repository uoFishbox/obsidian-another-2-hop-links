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

	beforeEach(() => {
		vault = createMockVault();
		metadataCache = createMockMetadataCache();
		vi.clearAllMocks();
	});

	test("runs up to three preview generations concurrently", async () => {
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
		const files = Array.from({ length: 4 }, (_, index) =>
			createMockTFileAsPlainObject(`${index}.md`),
		);
		const promises = files.map((file) => service.getPreview(file));

		expect(resolvePreview).toHaveBeenCalledTimes(3);
		expect(resolvePreview).not.toHaveBeenCalledWith(
			files[3],
			expect.anything(),
			expect.anything(),
		);

		deferredByPath.get(files[0].path)?.resolve({
			type: "text",
			content: "0",
		});
		await expect(promises[0]).resolves.toEqual({
			type: "text",
			content: "0",
		});
		await Promise.resolve();

		expect(resolvePreview).toHaveBeenCalledTimes(4);

		for (const file of files.slice(1)) {
			deferredByPath.get(file.path)?.resolve({
				type: "text",
				content: file.path,
			});
		}
		await Promise.all(promises.slice(1));
	});

	test("removes an aborted preview before it starts", async () => {
		const firstDeferred = createDeferred<PreviewData>();
		const resolvePreview = vi.fn<PreviewResolver>(() => firstDeferred.promise);
		const service = createService(resolvePreview);
		const activeFiles = Array.from({ length: 3 }, (_, index) =>
			createMockTFileAsPlainObject(`active-${index}.md`),
		);
		const secondFile = createMockTFileAsPlainObject("queued.md");
		const secondController = new AbortController();

		const activePromises = activeFiles.map((file) => service.getPreview(file));
		const secondPromise = service.getPreview(secondFile, secondController.signal);

		secondController.abort();
		await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });
		expect(resolvePreview).toHaveBeenCalledTimes(3);

		firstDeferred.resolve({ type: "text", content: "active" });
		await Promise.all(activePromises);
		await Promise.resolve();
	});

	test("dispose aborts active and queued generation", async () => {
		const resolvePreview = vi.fn<PreviewResolver>(
			(_file, _context, signal) =>
				new Promise<PreviewData>((_resolve, reject) => {
					signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		);
		const service = createService(resolvePreview);
		const files = Array.from({ length: 4 }, (_, index) =>
			createMockTFileAsPlainObject(`${index}.md`),
		);
		const requests = files.map((file) => service.getPreview(file));

		expect(resolvePreview).toHaveBeenCalledTimes(3);

		service.dispose();

		for (const request of requests) {
			await expect(request).rejects.toMatchObject({ name: "AbortError" });
		}
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
});
