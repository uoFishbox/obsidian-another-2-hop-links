import { describe, expect, test } from "vitest";
import {
	createFileLocalAggregation,
	createSourceSummaryFromAggregation,
	createSourceSummaryFromAggregationChunked,
	recordFileLocalReference,
	type FileLocalAggregation,
} from "../backlink-builder/backlinkAggregation";
import type { SourceSummary } from "../types/IndexTypes";
import type { YieldScheduler } from "../timeSlicing";
import type { LinkCache } from "obsidian";
import type { ResolvedLinkInfo } from "../link-resolution/linkResolution";

const NO_YIELD_SCHEDULER: YieldScheduler = {
	checkpoint: () => undefined,
};

describe("backlinkAggregation", () => {
	test("stores resolved state in fused lookup entries", () => {
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
		expect(syncSummary?.lookupEntries.get("sync.md")?.isUnresolved).toBe(false);
		expect(firstChunkedSummary?.lookupEntries.get("first.md")?.isUnresolved).toBe(
			false,
		);
		expect(secondChunkedSummary?.lookupEntries.get("second.md")?.isUnresolved).toBe(
			false,
		);
	});

	test("snapshots non-empty unresolved lookup keys into the summary", () => {
		const aggregation = createFileLocalAggregation();
		recordFileLocalReference(
			aggregation,
			createLinkCache("missing", 0),
			createUnresolvedResolvedInfo("missing.md"),
			0,
			"missing",
		);

		const summary = createChunkedSummary(aggregation);
		recordFileLocalReference(
			aggregation,
			createLinkCache("later", 1),
			createUnresolvedResolvedInfo("later.md"),
			1,
			"later",
		);

		expect(summary?.lookupEntries.get("missing.md")?.isUnresolved).toBe(true);
	});

	test("keeps fused lookup-key states in one persistent summary map", () => {
		const aggregation = createAggregationWithResolvedLookupKey("target.md");
		const representative =
			aggregation.lookupKeyStates.get("target.md")!.representative;
		aggregation.destinationBuckets.set("target.md", {
			count: 2,
			hasResolved: true,
			firstRef: representative,
		});

		const destinationBuckets = aggregation.destinationBuckets;
		const lookupKeyStates = aggregation.lookupKeyStates;

		const summary = createChunkedSummary(aggregation);

		expect(summary).toBeDefined();
		// The destination scratch map itself becomes the persistent summary map.
		expect(summary?.destinations).toBe(destinationBuckets);
		// The fused lookup scratch map itself becomes the persistent summary map.
		expect(summary?.lookupEntries).toBe(lookupKeyStates);
		// The scratch slots are emptied for the next file.
		expect(aggregation.destinationBuckets.size).toBe(0);
		expect(aggregation.lookupKeyStates.size).toBe(0);

		// The shared representative is deduplicated into one ordered entry.
		expect(summary?.destinations.get("target.md")).toEqual({
			count: 2,
			hasResolved: true,
			firstRefIndex: 0,
		});
		expect(summary?.lookupEntries.get("target.md")).toEqual({
			firstRefIndex: 0,
			rawLinkPaths: "target.md",
			isUnresolved: false,
		});
		expect(summary?.orderedReferences).toHaveLength(1);
	});
});

function createAggregationWithResolvedLookupKey(
	lookupKey: string,
): FileLocalAggregation {
	const aggregation = createFileLocalAggregation();
	aggregation.lookupKeyStates.set(lookupKey, {
		representative: {
			ref: {
				destinationPath: lookupKey,
				rawLookupKey: lookupKey,
				isUnresolved: false,
				rawText: `[[${lookupKey}]]`,
			},
			offset: 0,
		},
		rawLinkPaths: lookupKey,
		isUnresolved: false,
	});
	return aggregation;
}

function createLinkCache(linkText: string, offset: number): LinkCache {
	return {
		link: linkText,
		original: `[[${linkText}]]`,
		displayText: linkText,
		position: {
			start: { line: 0, col: 0, offset },
			end: { line: 0, col: 0, offset },
		},
	};
}

function createUnresolvedResolvedInfo(lookupKey: string): ResolvedLinkInfo {
	return {
		destinationPath: lookupKey,
		rawLookupKey: lookupKey,
		isUnresolved: true,
		isAmbiguous: false,
		isSourceDependent: false,
	};
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
