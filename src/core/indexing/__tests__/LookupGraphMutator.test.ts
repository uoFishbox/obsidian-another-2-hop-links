import { describe, expect, test } from "vitest";
import {
	refreshUnresolvedLookupForKeyAsync,
	replaceSourceSummaryAsync,
} from "../backlink-builder/lookupGraphMutator";
import { createEmptyIndexSnapshot } from "../types/IndexTypes";
import type { BacklinkBucket } from "types/domain";
import type { SourceSummary } from "../types/IndexTypes";

describe("LookupGraphMutator", () => {
	test("refreshUnresolvedLookupForKey aggregates sources of sibling lookupPaths", async () => {
		const snapshot = createEmptyIndexSnapshot();

		snapshot.lookupKeyToLookupPaths.set("foo.md", new Set(["Foo.md", "foo.md"]));
		snapshot.backlinksMap.set("Foo.md", new Map([["source-a.md", bucket()]]));
		snapshot.backlinksMap.set("foo.md", new Map([["source-b.md", bucket()]]));

		await refreshUnresolvedLookupForKeyAsync(
			snapshot,
			"foo.md",
			createImmediateYieldScheduler(),
		);

		expect(snapshot.lookupKeyToSources.get("foo.md")).toEqual(
			new Set(["source-a.md", "source-b.md"]),
		);
		expect(snapshot.unresolvedLookupToSources.get("foo.md")).toEqual(
			new Set(["source-a.md", "source-b.md"]),
		);
	});

	test("refreshUnresolvedLookupForKey reuses existing lookup source set", async () => {
		const snapshot = createEmptyIndexSnapshot();
		const sources = new Set(["stale-source.md"]);

		snapshot.lookupKeyToSources.set("foo.md", sources);
		snapshot.unresolvedLookupToSources.set("foo.md", sources);
		snapshot.lookupKeyToLookupPaths.set("foo.md", new Set(["foo.md"]));
		snapshot.backlinksMap.set("foo.md", new Map([["source-a.md", bucket()]]));

		await refreshUnresolvedLookupForKeyAsync(
			snapshot,
			"foo.md",
			createImmediateYieldScheduler(),
		);

		expect(snapshot.lookupKeyToSources.get("foo.md")).toBe(sources);
		expect(snapshot.unresolvedLookupToSources.get("foo.md")).toBe(sources);
		expect(sources).toEqual(new Set(["source-a.md"]));
	});

	test("lookupKeys with resolved paths are not left in the unresolved reverse index", async () => {
		const snapshot = createEmptyIndexSnapshot();

		snapshot.lookupKeyToLookupPaths.set("foo.md", new Set(["foo.md"]));
		snapshot.backlinksMap.set("foo.md", new Map([["source-a.md", bucket()]]));
		snapshot.lookupKeyDirectResolvedPathCount.set("foo.md", 1);

		await refreshUnresolvedLookupForKeyAsync(
			snapshot,
			"foo.md",
			createImmediateYieldScheduler(),
		);

		expect(snapshot.lookupKeyToSources.get("foo.md")).toEqual(
			new Set(["source-a.md"]),
		);
		expect(snapshot.unresolvedLookupToSources.has("foo.md")).toBe(false);
	});

	test("replaceSourceSummaryAsync yields during previous key removal", async () => {
		const snapshot = createEmptyIndexSnapshot();
		const sourcePath = "source.md";

		const lookupKeyCount = 256;
		const firstRefIndexByLookupKey = new Map<string, number>();
		for (let i = 0; i < lookupKeyCount; i++) {
			const key = `prev-lookup-${i}.md`;
			firstRefIndexByLookupKey.set(key, i);
			snapshot.linkLookupToSources.set(key, new Set([sourcePath]));
		}

		const previousSummary: SourceSummary = {
			destinations: new Map(),
			orderedReferences: [],
			firstRefIndexByLookupKey,
			lookupKeyToRawLinkPaths: new Map(),
			unresolvedLookupKeys: new Set(),
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

		const nextSummary: SourceSummary = {
			destinations: new Map(),
			orderedReferences: [],
			firstRefIndexByLookupKey,
			lookupKeyToRawLinkPaths: new Map(),
			unresolvedLookupKeys: new Set(),
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
		expect(
			snapshot.linkLookupToSources.get("next-lookup-0.md")?.has(sourcePath),
		).toBe(true);
		expect(
			snapshot.linkLookupToSources.get("next-lookup-255.md")?.has(sourcePath),
		).toBe(true);
	});
});

function bucket(): BacklinkBucket {
	return {
		count: 1,
		hasResolved: false,
	};
}

function createImmediateYieldScheduler() {
	return {
		checkpoint: () => undefined,
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
