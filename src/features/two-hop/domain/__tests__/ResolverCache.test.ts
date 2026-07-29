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
		expect(cached).toBe(result);
		expect(
			cache.get(
				"origin.md",
				defaultPerformanceSettings(),
				defaultResolveSettings(),
			),
		).toBe(cached);
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

	test("freezes the cached snapshot and isolates copied dependencies", () => {
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

		const externalLink = {
			rawText: "mutated",
			path: "mutated.md",
			isUnresolved: false,
			sourceFile: createMockTFile("mutated.md"),
		};
		expect(Reflect.set(result.backlinks, 0, externalLink)).toBe(false);
		dependencies.dependencyPaths.clear();

		const first = cache.get(
			"origin.md",
			defaultPerformanceSettings(),
			defaultResolveSettings(),
		)!;
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.backlinks)).toBe(true);

		const second = cache.get(
			"origin.md",
			defaultPerformanceSettings(),
			defaultResolveSettings(),
		);
		expect(second).toBe(first);
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

	test("freezes resolver-owned values without freezing Obsidian-owned references", () => {
		const cache = new ResolverCache();
		const sourceFile = createMockTFile("source.md");
		const position = {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: 0, col: 4, offset: 4 },
		};
		const hop1 = {
			rawText: "target",
			path: "target.md",
			isUnresolved: false,
			sourceFile,
			position,
		};
		const hop2 = [
			{
				rawText: "target",
				path: "target.md",
				isUnresolved: false,
				sourceFile,
			},
		];
		const commonTags = ["tag"];
		const result: TwoHopLinkResult = {
			originFile: createMockTFile("origin.md"),
			branches: [{ hop1, hop2 }],
			backlinks: hop2,
			taggedNotes: [
				{
					file: sourceFile,
					commonTags,
					path: sourceFile.path,
					position,
				},
			],
			displayVersions: { links: "1:complete", tags: "1:tags" },
		};

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
		)!;
		expect(cached).toBe(result);
		expect(cached.branches[0].hop1).toBe(hop1);
		expect(cached.branches[0].hop2).toBe(hop2);
		expect(cached.backlinks).toBe(hop2);
		expect(cached.taggedNotes[0].commonTags).toBe(commonTags);
		expect(Object.isFrozen(cached.branches)).toBe(true);
		expect(Object.isFrozen(cached.branches[0])).toBe(true);
		expect(Object.isFrozen(hop1)).toBe(true);
		expect(Object.isFrozen(hop2)).toBe(true);
		expect(Object.isFrozen(hop2[0])).toBe(true);
		expect(Object.isFrozen(cached.taggedNotes)).toBe(true);
		expect(Object.isFrozen(cached.taggedNotes[0])).toBe(true);
		expect(Object.isFrozen(commonTags)).toBe(true);
		expect(Object.isFrozen(cached.displayVersions)).toBe(true);
		expect(Object.isFrozen(sourceFile)).toBe(false);
		expect(Object.isFrozen(position)).toBe(false);
	});
});
