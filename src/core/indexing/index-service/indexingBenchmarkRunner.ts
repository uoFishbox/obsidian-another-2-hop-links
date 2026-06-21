import {
	INDEXING_REBUILD_YIELD_INTERVAL_MS,
	INDEX_LINK_CAPABLE_EXTENSIONS,
} from "../../../appConstants";
import type { IMetadataCache, IVault } from "types/obsidian";
import { IndexingService } from "./IndexingService";

export interface IndexingBenchmarkIterationResult {
	iteration: number;
	durationMs: number;
	backlinksEntries: number;
	tagFiles: number;
}

export interface IndexingBenchmarkResult {
	iterations: number;
	durationsMs: number[];
	averageMs: number;
	minMs: number;
	maxMs: number;
	totalFiles: number;
	linkCapableFiles: number;
	lastBacklinksEntryCount: number;
	lastTagFileCount: number;
	iterationResults: IndexingBenchmarkIterationResult[];
}

interface BenchmarkIndexingService {
	rebuildBacklinksMapChunked(yieldIntervalMs?: number): Promise<void>;
	getBacklinksMap(): Map<string, unknown>;
	getTagIndexFileCount(): number;
}

export interface RunIndexingBenchmarkOptions {
	iterations?: number;
	yieldIntervalMs?: number;
	now?: () => number;
	createIndexingService?: (
		vault: IVault,
		metadataCache: IMetadataCache,
	) => BenchmarkIndexingService;
}

/**
 * Measures repeated full index rebuilds for the supplied vault.
 */
export async function runIndexingBenchmark(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: RunIndexingBenchmarkOptions = {},
): Promise<IndexingBenchmarkResult> {
	const iterations = options.iterations ?? 5;
	const yieldIntervalMs =
		options.yieldIntervalMs ?? INDEXING_REBUILD_YIELD_INTERVAL_MS;
	const now = options.now ?? (() => performance.now());
	const createIndexingService =
		options.createIndexingService ??
		((vault, metadataCache) =>
			new IndexingService(vault, metadataCache, () => true));
	const allFiles = vault.getFiles();
	const linkCapableFiles = allFiles.filter((file) =>
		INDEX_LINK_CAPABLE_EXTENSIONS.has(file.extension.toLowerCase()),
	).length;
	const service = createIndexingService(vault, metadataCache);
	const iterationResults: IndexingBenchmarkIterationResult[] = [];

	for (let iteration = 1; iteration <= iterations; iteration++) {
		const startTime = now();
		await service.rebuildBacklinksMapChunked(yieldIntervalMs);
		const durationMs = now() - startTime;
		iterationResults.push({
			iteration,
			durationMs,
			backlinksEntries: service.getBacklinksMap().size,
			tagFiles: service.getTagIndexFileCount(),
		});
	}

	const durationsMs = iterationResults.map((result) => result.durationMs);
	const lastResult = iterationResults[iterationResults.length - 1];

	return {
		iterations,
		durationsMs,
		averageMs: calculateAverage(durationsMs),
		minMs: Math.min(...durationsMs),
		maxMs: Math.max(...durationsMs),
		totalFiles: allFiles.length,
		linkCapableFiles,
		lastBacklinksEntryCount: lastResult?.backlinksEntries ?? 0,
		lastTagFileCount: lastResult?.tagFiles ?? 0,
		iterationResults,
	};
}

function calculateAverage(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}

	const total = values.reduce((sum, value) => sum + value, 0);
	return total / values.length;
}
