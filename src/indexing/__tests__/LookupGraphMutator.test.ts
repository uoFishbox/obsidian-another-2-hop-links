import { describe, expect, test } from "vitest";
import { replaceSourceSummaryAsync } from "../backlink-builder/lookupGraphMutator";
import {
	collectSourcePathsForLookupKeys,
	hasDirectResolvedLookupKey,
} from "../backlink-builder/lookupGraphQueries";
import { createEmptyIndexSnapshot } from "../indexState";
import type { BacklinkBucket } from "indexing/model";
import type { SourceSummary } from "../indexState";

describe("LookupGraphMutator", () => {
	test("collectSourcePathsForLookupKeys aggregates sources of sibling lookupPaths", () => {
		const snapshot = createEmptyIndexSnapshot();

		snapshot.lookupKeyToLookupPaths.set("foo.md", new Set(["Foo.md", "foo.md"]));
		snapshot.backlinksMap.set("Foo.md", new Map([["source-a.md", bucket()]]));
		snapshot.backlinksMap.set("foo.md", new Map([["source-b.md", bucket()]]));

		expect(collectSourcePathsForLookupKeys(snapshot, ["foo.md"])).toEqual(
			new Set(["source-a.md", "source-b.md"]),
		);
	});

	test("collectSourcePathsForLookupKeys deduplicates sources across sibling lookupPaths", () => {
		const snapshot = createEmptyIndexSnapshot();

		snapshot.lookupKeyToLookupPaths.set("foo.md", new Set(["Foo.md", "foo.md"]));
		snapshot.backlinksMap.set("Foo.md", new Map([["source-a.md", bucket()]]));
		snapshot.backlinksMap.set("foo.md", new Map([["source-a.md", bucket()]]));

		expect(collectSourcePathsForLookupKeys(snapshot, ["foo.md"])).toEqual(
			new Set(["source-a.md"]),
		);
	});

	test("hasDirectResolvedLookupKey derives direct resolution from sibling paths", () => {
		const snapshot = createEmptyIndexSnapshot();

		snapshot.lookupKeyToLookupPaths.set("foo.md", new Set(["Foo.md", "foo.md"]));
		snapshot.lookupPathResolvedSourceCount.set("Foo.md", 1);

		expect(hasDirectResolvedLookupKey(snapshot, "foo.md")).toBe(true);
		snapshot.lookupPathResolvedSourceCount.delete("Foo.md");
		expect(hasDirectResolvedLookupKey(snapshot, "foo.md")).toBe(false);
	});

	test("replaceSourceSummaryAsync yields during previous key removal", async () => {
		const snapshot = createEmptyIndexSnapshot();
		const sourcePath = "source.md";

		const lookupKeyCount = 256;
		const firstRefIndexByLookupKey = new Map<string, number>();
		for (let i = 0; i < lookupKeyCount; i++) {
			const key = `prev-lookup-${i}.md`;
			firstRefIndexByLookupKey.set(key, i);
			snapshot.linkLookupToSources.set(key, sourcePath);
		}
		const lookupEntries = new Map(
			Array.from(
				firstRefIndexByLookupKey,
				([lookupKey, firstRefIndex]) =>
					[
						lookupKey,
						{ firstRefIndex, rawLinkPaths: lookupKey, isUnresolved: false },
					] as const,
			),
		);

		const previousSummary: SourceSummary = {
			destinations: new Map(),
			orderedReferences: [],
			lookupEntries,
			hasSourceDependentLinks: false,
		};
		snapshot.sourceSummaries.set(sourcePath, previousSummary);

		const countingScheduler = createCountingYieldScheduler();
		await replaceSourceSummaryAsync(
			snapshot,
			sourcePath,
			undefined,
			countingScheduler.scheduler,
		);

		expect(countingScheduler.yieldCalls).toBeGreaterThan(0);
		expect(snapshot.sourceSummaries.has(sourcePath)).toBe(false);
		expect(snapshot.linkLookupToSources.has("prev-lookup-0.md")).toBe(false);
		expect(snapshot.linkLookupToSources.has("prev-lookup-255.md")).toBe(false);
	});

	test("replaceSourceSummaryAsync yields during next key addition", async () => {
		const snapshot = createEmptyIndexSnapshot();
		const sourcePath = "source.md";

		const lookupKeyCount = 256;
		const firstRefIndexByLookupKey = new Map<string, number>();
		for (let i = 0; i < lookupKeyCount; i++) {
			firstRefIndexByLookupKey.set(`next-lookup-${i}.md`, i);
		}
		const lookupEntries = new Map(
			Array.from(
				firstRefIndexByLookupKey,
				([lookupKey, firstRefIndex]) =>
					[
						lookupKey,
						{ firstRefIndex, rawLinkPaths: lookupKey, isUnresolved: false },
					] as const,
			),
		);

		const nextSummary: SourceSummary = {
			destinations: new Map(),
			orderedReferences: [],
			lookupEntries,
			hasSourceDependentLinks: false,
		};

		const countingScheduler = createCountingYieldScheduler();
		await replaceSourceSummaryAsync(
			snapshot,
			sourcePath,
			nextSummary,
			countingScheduler.scheduler,
		);

		expect(countingScheduler.yieldCalls).toBeGreaterThan(0);
		expect(snapshot.sourceSummaries.get(sourcePath)).toBe(nextSummary);
		expect(snapshot.linkLookupToSources.get("next-lookup-0.md")).toBe(sourcePath);
		expect(snapshot.linkLookupToSources.get("next-lookup-255.md")).toBe(sourcePath);
	});
});

function bucket(): BacklinkBucket {
	return {
		count: 1,
		hasResolved: false,
	};
}

function createCountingYieldScheduler() {
	let yieldCalls = 0;
	return {
		scheduler: {
			checkpoint: (_iteration: number, _cadence: number) => {
				yieldCalls++;
				return undefined;
			},
		},
		get yieldCalls() {
			return yieldCalls;
		},
	};
}
