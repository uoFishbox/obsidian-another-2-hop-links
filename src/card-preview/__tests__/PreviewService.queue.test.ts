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

	test("runs preview generation serially", async () => {
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

		expect(resolvePreview).toHaveBeenCalledTimes(1);

		deferredByPath.get(firstFile.path)?.resolve({
			type: "text",
			content: "first",
		});
		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "first",
		});
		await Promise.resolve();

		expect(resolvePreview).toHaveBeenCalledTimes(2);

		deferredByPath.get(secondFile.path)?.resolve({
			type: "text",
			content: "second",
		});
		await expect(secondPromise).resolves.toEqual({
			type: "text",
			content: "second",
		});
		await Promise.resolve();
	});

	test("removes an aborted preview before it starts", async () => {
		const firstDeferred = createDeferred<PreviewData>();
		const resolvePreview = vi.fn<PreviewResolver>(() => firstDeferred.promise);
		const service = createService(resolvePreview);
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");
		const secondController = new AbortController();

		const firstPromise = service.getPreview(firstFile);
		const secondPromise = service.getPreview(secondFile, secondController.signal);

		secondController.abort();
		await expect(secondPromise).rejects.toMatchObject({ name: "AbortError" });
		expect(resolvePreview).toHaveBeenCalledTimes(1);

		firstDeferred.resolve({ type: "text", content: "first" });
		await expect(firstPromise).resolves.toEqual({
			type: "text",
			content: "first",
		});
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
		const firstFile = createMockTFileAsPlainObject("first.md");
		const secondFile = createMockTFileAsPlainObject("second.md");

		const first = service.getPreview(firstFile);
		const second = service.getPreview(secondFile);

		service.dispose();

		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
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
