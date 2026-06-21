import { Notice, type Plugin } from "obsidian";
import {
	runIndexingBenchmark,
	type IndexingBenchmarkResult,
} from "core/indexing/index-service/indexingBenchmarkRunner";
import type { IndexingService } from "core/indexing/index-service/IndexingService";

/**
 * Manages the "Benchmark rebuildBacklinksMapChunked" command lifecycle.
 * Keeps the running-benchmark guard state out of the plugin entry point.
 */
export function registerBenchmarkCommand(
	plugin: Plugin,
	indexingService: IndexingService,
): void {
	let benchmarkPromise: Promise<void> | null = null;

	plugin.addCommand({
		id: "benchmark-rebuild-backlinks-map-chunked",
		name: "Benchmark rebuildBacklinksMapChunked",
		callback: () => {
			void runBenchmark();
		},
	});

	async function runBenchmark(): Promise<void> {
		if (benchmarkPromise) {
			new Notice("Benchmark is already running.");
			return;
		}

		const promise = executeBenchmark();
		benchmarkPromise = promise;

		try {
			await promise;
		} finally {
			if (benchmarkPromise === promise) {
				benchmarkPromise = null;
			}
		}
	}

	async function executeBenchmark(): Promise<void> {
		new Notice("Benchmarking rebuildBacklinksMapChunked (5 runs)...");
		await indexingService.awaitIdle();

		try {
			const result = await runIndexingBenchmark(
				plugin.app.vault,
				plugin.app.metadataCache,
			);
			logBenchmarkResult(result);
			new Notice(
				`Benchmark completed: avg ${result.averageMs.toFixed(2)}ms over ${result.iterations} runs. Check console for details.`,
			);
		} catch (error) {
			console.error(
				"[Cosense card links] rebuildBacklinksMapChunked benchmark failed:",
				error,
			);
			new Notice("Benchmark failed. Check console for details.");
		}
	}
}

function logBenchmarkResult(result: IndexingBenchmarkResult): void {
	console.group(
		"[Cosense card links] rebuildBacklinksMapChunked benchmark",
	);
	console.log("Summary", {
		iterations: result.iterations,
		averageMs: Number(result.averageMs.toFixed(2)),
		minMs: Number(result.minMs.toFixed(2)),
		maxMs: Number(result.maxMs.toFixed(2)),
		totalFiles: result.totalFiles,
		linkCapableFiles: result.linkCapableFiles,
		lastBacklinksEntryCount: result.lastBacklinksEntryCount,
		lastTagFileCount: result.lastTagFileCount,
	});
	console.table(
		result.iterationResults.map((entry) => ({
			iteration: entry.iteration,
			durationMs: Number(entry.durationMs.toFixed(2)),
			backlinksEntries: entry.backlinksEntries,
			tagFiles: entry.tagFiles,
		})),
	);
	console.groupEnd();
}
