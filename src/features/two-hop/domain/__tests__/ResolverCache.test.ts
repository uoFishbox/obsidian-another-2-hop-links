import { describe, test, expect } from "vitest";
import { ResolverCache } from "../ResolverCache";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { TwoHopLinkResult } from "types/domain";
import { TFile } from "obsidian";

function createMockTFile(path: string): TFile {
	return { path, extension: "md" } as TFile;
}

function createMockResult(): TwoHopLinkResult {
	return {
		originFile: createMockTFile("origin.md"),
		branches: [],
		backlinks: [],
		taggedNotes: [],
		displayVersions: { links: "1:twohop", tags: "1:tags" },
	};
}

function defaultPerformanceSettings() {
	return {
		enableProgressiveTwoHopBuild: true,
		maxOutgoingToProcess: 0,
		maxHop2PerBranch: 0,
	};
}

function defaultResolveSettings() {
	return {
		includeTaggedNotes: true,
	};
}

function defaultDependencies() {
	return {
		dependencyPaths: new Set<string>(),
		dependencyLookupKeys: new Set<string>(),
		dependencyTags: new Set<string>(),
	};
}

describe("ResolverCache", () => {
	test("returns cached result when settings match", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		const cached = cache.get(
			"origin.md",
			defaultPerformanceSettings(),
			defaultResolveSettings(),
		);

		expect(cached).toEqual(result);
		expect(cached).not.toBe(result);
	});

	test("miss when performance settings differ", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		const cached = cache.get(
			"origin.md",
			{ ...defaultPerformanceSettings(), enableProgressiveTwoHopBuild: false },
			defaultResolveSettings(),
		);

		expect(cached).toBeUndefined();
	});

	test("miss when includeTaggedNotes differs", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		const cached = cache.get("origin.md", defaultPerformanceSettings(), {
			includeTaggedNotes: false,
		});

		expect(cached).toBeUndefined();
	});

	test("evicts only relevant cache by affectedPaths", () => {
		const cache = new ResolverCache();
		const resultA = createMockResult();
		const resultB = createMockResult();

		cache.set(
			"a.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				dependencyPaths: new Set(["note1.md"]),
			},
			resultA,
		);
		cache.set(
			"b.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				dependencyPaths: new Set(["note2.md"]),
			},
			resultB,
		);

		cache.invalidate({
			indexVersion: 2,
			affectedPaths: ["note1.md"],
		});

		expect(
			cache.get("a.md", defaultPerformanceSettings(), defaultResolveSettings()),
		).toBeUndefined();
		expect(
			cache.get("b.md", defaultPerformanceSettings(), defaultResolveSettings()),
		).toEqual(resultB);
	});

	test("evicts only relevant cache by affectedLookupKeys", () => {
		const cache = new ResolverCache();
		const resultA = createMockResult();
		const resultB = createMockResult();

		cache.set(
			"a.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				dependencyLookupKeys: new Set(["missing-note.md"]),
			},
			resultA,
		);
		cache.set(
			"b.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				dependencyLookupKeys: new Set(["other-missing.md"]),
			},
			resultB,
		);

		cache.invalidate({
			indexVersion: 2,
			affectedLookupKeys: ["missing-note.md"],
		});

		expect(
			cache.get("a.md", defaultPerformanceSettings(), defaultResolveSettings()),
		).toBeUndefined();
		expect(
			cache.get("b.md", defaultPerformanceSettings(), defaultResolveSettings()),
		).toEqual(resultB);
	});

	test("evicts only relevant cache by affectedTags", () => {
		const cache = new ResolverCache();
		const resultA = createMockResult();
		const resultB = createMockResult();

		cache.set(
			"a.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				dependencyTags: new Set(["tag1"]),
			},
			resultA,
		);
		cache.set(
			"b.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				dependencyTags: new Set(["tag2"]),
			},
			resultB,
		);

		cache.invalidate({
			indexVersion: 2,
			affectedTags: ["tag1"],
		});

		expect(
			cache.get("a.md", defaultPerformanceSettings(), defaultResolveSettings()),
		).toBeUndefined();
		expect(
			cache.get("b.md", defaultPerformanceSettings(), defaultResolveSettings()),
		).toEqual(resultB);
	});

	test("retains cache on unrelated update", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			{
				dependencyPaths: new Set(["note1.md"]),
				dependencyLookupKeys: new Set(["lookup1.md"]),
				dependencyTags: new Set(["tag1"]),
			},
			result,
		);

		cache.invalidate({
			indexVersion: 2,
			affectedPaths: ["unrelated.md"],
			affectedLookupKeys: ["unrelated-lookup.md"],
			affectedTags: ["unrelated-tag"],
		});

		const cached = cache.get(
			"origin.md",
			defaultPerformanceSettings(),
			defaultResolveSettings(),
		);

		expect(cached).toEqual(result);
	});

	test("clears on affectsAll", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		cache.invalidate({
			indexVersion: 2,
			affectsAll: true,
		});

		expect(
			cache.get(
				"origin.md",
				defaultPerformanceSettings(),
				defaultResolveSettings(),
			),
		).toBeUndefined();
	});

	test("clears when no context", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		cache.invalidate();

		expect(
			cache.get(
				"origin.md",
				defaultPerformanceSettings(),
				defaultResolveSettings(),
			),
		).toBeUndefined();
	});

	test("clears when affected set is empty", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		cache.invalidate({
			indexVersion: 2,
			affectedPaths: [],
			affectedLookupKeys: [],
			affectedTags: [],
		});

		expect(
			cache.get(
				"origin.md",
				defaultPerformanceSettings(),
				defaultResolveSettings(),
			),
		).toBeUndefined();
	});

	test("cached result and dependencies are isolated from caller mutations", () => {
		const cache = new ResolverCache();
		const result = createMockResult();
		const dependencies = {
			...defaultDependencies(),
			dependencyPaths: new Set(["note1.md"]),
		};

		cache.set(
			"origin.md",
			1,
			defaultPerformanceSettings(),
			defaultResolveSettings(),
			dependencies,
			result,
		);

		result.backlinks.push({
			rawText: "mutated",
			path: "mutated.md",
			isUnresolved: false,
			sourceFile: createMockTFile("mutated.md"),
		});
		dependencies.dependencyPaths.clear();

		const first = cache.get(
			"origin.md",
			defaultPerformanceSettings(),
			defaultResolveSettings(),
		)!;
		first.backlinks.push({
			rawText: "external",
			path: "external.md",
			isUnresolved: false,
			sourceFile: createMockTFile("external.md"),
		});

		const second = cache.get(
			"origin.md",
			defaultPerformanceSettings(),
			defaultResolveSettings(),
		);
		expect(second?.backlinks).toEqual([]);

		cache.invalidate({
			indexVersion: 2,
			affectedPaths: ["note1.md"],
		});
		expect(
			cache.get(
				"origin.md",
				defaultPerformanceSettings(),
				defaultResolveSettings(),
			),
		).toBeUndefined();
	});
});
