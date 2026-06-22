import { describe, expect, test, vi } from "vitest";
import type { IMetadataCache, IVault } from "types/obsidian";
import { runIndexingBenchmark } from "../index-service/indexingBenchmarkRunner";

interface BenchmarkRunShape {
	backlinksEntries: number;
	tagFiles: number;
}

function createMockVault(extensions: string[]): IVault {
	return {
		getFiles: vi.fn(() =>
			extensions.map((extension, index) => ({
				path: `file-${index}.${extension}`,
				extension,
			})),
		),
		getMarkdownFiles: vi.fn(() => []),
		getAbstractFileByPath: vi.fn(() => null),
		cachedRead: vi.fn(),
		getResourcePath: vi.fn(),
	} as unknown as IVault;
}

function createMockMetadataCache(): IMetadataCache {
	return {} as IMetadataCache;
}

function createBenchmarkService(runs: BenchmarkRunShape[], failAt?: number) {
	let callCount = 0;
	let currentRun: BenchmarkRunShape = { backlinksEntries: 0, tagFiles: 0 };

	const service = {
		rebuildBacklinksMapChunked: vi.fn(async (_yieldIntervalMs?: number) => {
			callCount++;
			if (failAt && callCount === failAt) {
				throw new Error("benchmark failed");
			}
			currentRun = runs[callCount - 1] ?? currentRun;
		}),
		getBacklinksMap: vi.fn(() => {
			const entries = Array.from(
				{ length: currentRun.backlinksEntries },
				(_, index) => [`path-${index}`, {}] as const,
			);
			return new Map(entries);
		}),
		getTagIndexFileCount: vi.fn(() => currentRun.tagFiles),
	};

	return service;
}

describe("runIndexingBenchmark", () => {
	test("runs rebuildBacklinksMapChunked a fixed number of times and returns statistics", async () => {
		const mockVault = createMockVault(["md", "canvas", "png", "base"]);
		const metadataCache = createMockMetadataCache();
		const service = createBenchmarkService([
			{ backlinksEntries: 10, tagFiles: 3 },
			{ backlinksEntries: 11, tagFiles: 3 },
			{ backlinksEntries: 12, tagFiles: 4 },
			{ backlinksEntries: 13, tagFiles: 4 },
			{ backlinksEntries: 14, tagFiles: 5 },
		]);
		const createIndexingService = vi.fn(() => service);
		const now = vi
			.fn()
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(10)
			.mockReturnValueOnce(10)
			.mockReturnValueOnce(25)
			.mockReturnValueOnce(25)
			.mockReturnValueOnce(45)
			.mockReturnValueOnce(45)
			.mockReturnValueOnce(70)
			.mockReturnValueOnce(70)
			.mockReturnValueOnce(100);

		const result = await runIndexingBenchmark(mockVault, metadataCache, {
			yieldIntervalMs: 42,
			now,
			createIndexingService,
		});

		expect(createIndexingService).toHaveBeenCalledTimes(1);
		expect(service.rebuildBacklinksMapChunked).toHaveBeenCalledTimes(5);
		expect(service.rebuildBacklinksMapChunked).toHaveBeenNthCalledWith(
			1,
			42,
		);
		expect(service.rebuildBacklinksMapChunked).toHaveBeenNthCalledWith(
			5,
			42,
		);
		expect(result.iterations).toBe(5);
		expect(result.durationsMs).toEqual([10, 15, 20, 25, 30]);
		expect(result.averageMs).toBe(20);
		expect(result.minMs).toBe(10);
		expect(result.maxMs).toBe(30);
		expect(result.totalFiles).toBe(4);
		expect(result.linkCapableFiles).toBe(2);
		expect(result.lastBacklinksEntryCount).toBe(14);
		expect(result.lastTagFileCount).toBe(5);
		expect(result.iterationResults).toEqual([
			{ iteration: 1, durationMs: 10, backlinksEntries: 10, tagFiles: 3 },
			{ iteration: 2, durationMs: 15, backlinksEntries: 11, tagFiles: 3 },
			{ iteration: 3, durationMs: 20, backlinksEntries: 12, tagFiles: 4 },
			{ iteration: 4, durationMs: 25, backlinksEntries: 13, tagFiles: 4 },
			{ iteration: 5, durationMs: 30, backlinksEntries: 14, tagFiles: 5 },
		]);
	});

	test("aborts and throws if rebuildBacklinksMapChunked fails partway through", async () => {
		const mockVault = createMockVault(["md", "canvas"]);
		const metadataCache = createMockMetadataCache();
		const service = createBenchmarkService(
			[
				{ backlinksEntries: 5, tagFiles: 2 },
				{ backlinksEntries: 6, tagFiles: 2 },
				{ backlinksEntries: 7, tagFiles: 3 },
			],
			3,
		);
		const createIndexingService = vi.fn(() => service);
		const now = vi
			.fn()
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(10)
			.mockReturnValueOnce(10)
			.mockReturnValueOnce(20)
			.mockReturnValueOnce(20);

		await expect(
			runIndexingBenchmark(mockVault, metadataCache, {
				now,
				createIndexingService,
			}),
		).rejects.toThrow("benchmark failed");
		expect(createIndexingService).toHaveBeenCalledTimes(1);
		expect(service.rebuildBacklinksMapChunked).toHaveBeenCalledTimes(3);
		expect(service.getBacklinksMap).toHaveBeenCalledTimes(2);
		expect(service.getTagIndexFileCount).toHaveBeenCalledTimes(2);
	});

	test("exposes link normalization cache stats on a warm-cache run", async () => {
		const mockVault = createMockVault(["md"]);
		const metadataCache = createMockMetadataCache();
		const service = createBenchmarkService([
			{ backlinksEntries: 1, tagFiles: 0 },
		]);
		const createIndexingService = vi.fn(() => service);
		const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(5);

		const result = await runIndexingBenchmark(mockVault, metadataCache, {
			iterations: 1,
			now,
			createIndexingService,
			clearCachesBetweenIterations: false,
		});

		expect(result.linkNormalizationCacheStats).toBeDefined();
		expect(result.linkNormalizationCacheStats?.length).toBe(3);
	});

	test("omits link normalization cache stats on a cold-cache run", async () => {
		const mockVault = createMockVault(["md"]);
		const metadataCache = createMockMetadataCache();
		const service = createBenchmarkService([
			{ backlinksEntries: 1, tagFiles: 0 },
		]);
		const createIndexingService = vi.fn(() => service);
		const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(5);

		const result = await runIndexingBenchmark(mockVault, metadataCache, {
			iterations: 1,
			now,
			createIndexingService,
			clearCachesBetweenIterations: true,
		});

		expect(result.linkNormalizationCacheStats).toBeUndefined();
	});
});
