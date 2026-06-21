import { describe, expect, test } from "vitest";
import {
	createFileLocalAggregation,
	createSourceSummaryFromAggregation,
	createSourceSummaryFromAggregationChunked,
	type FileLocalAggregation,
} from "../backlink-builder/backlinkAggregation";
import type { SourceSummary } from "../types/IndexTypes";
import type { YieldScheduler } from "../timeSlicing";

const NO_YIELD_SCHEDULER: YieldScheduler = {
	checkpoint: () => undefined,
};

describe("backlinkAggregation", () => {
	test("shares empty unresolved lookup keys across source summaries", () => {
		const syncSummary = createSourceSummaryFromAggregation(
			createAggregationWithResolvedLookupKey("sync.md"),
		);
		const firstChunkedSummary = createChunkedSummary(
			createAggregationWithResolvedLookupKey("first.md"),
		);
		const secondChunkedSummary = createChunkedSummary(
			createAggregationWithResolvedLookupKey("second.md"),
		);

		expect(syncSummary).toBeDefined();
		expect(firstChunkedSummary).toBeDefined();
		expect(secondChunkedSummary).toBeDefined();
		expect(syncSummary?.unresolvedLookupKeys).toBe(
			firstChunkedSummary?.unresolvedLookupKeys,
		);
		expect(firstChunkedSummary?.unresolvedLookupKeys).toBe(
			secondChunkedSummary?.unresolvedLookupKeys,
		);
	});

	test("copies non-empty unresolved lookup keys", () => {
		const aggregation = createAggregationWithResolvedLookupKey("target.md");
		aggregation.unresolvedLookupKeys.add("missing.md");

		const summary = createChunkedSummary(aggregation);
		aggregation.unresolvedLookupKeys.add("later.md");

		expect(summary?.unresolvedLookupKeys).toEqual(new Set(["missing.md"]));
		expect(summary?.unresolvedLookupKeys).not.toBe(
			aggregation.unresolvedLookupKeys,
		);
	});
});

function createAggregationWithResolvedLookupKey(
	lookupKey: string,
): FileLocalAggregation {
	const aggregation = createFileLocalAggregation();
	aggregation.firstRefByLookupKey.set(lookupKey, {
		ref: {
			destinationPath: lookupKey,
			rawLookupKey: lookupKey,
			isUnresolved: false,
			rawText: `[[${lookupKey}]]`,
		},
		offset: 0,
	});
	return aggregation;
}

function createChunkedSummary(
	aggregation: FileLocalAggregation,
): SourceSummary | undefined {
	const result = createSourceSummaryFromAggregationChunked(
		aggregation,
		NO_YIELD_SCHEDULER,
	).next();

	if (!result.done) {
		throw new Error("No-yield scheduler unexpectedly yielded");
	}

	return result.value;
}
