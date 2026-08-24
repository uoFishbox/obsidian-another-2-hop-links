import { describe, test, expect } from "vitest";
import { ResolverCache } from "../ResolverCache";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { TwoHopLinkResult } from "types/domain";
import { TFile } from "obsidian";
import { createTwoHopResolveSnapshot } from "../ResolverDependencies";
import { freezeTwoHopLinkResult } from "../TwoHopLinkResolver";

function createMockTFile(path: string): TFile {
	return { path, extension: "md" } as TFile;
}

function createMockResult(): TwoHopLinkResult {
	return {
		originFile: createMockTFile("origin.md"),
		branches: [],
		backlinks: [],
		taggedNotes: [],
	};
}

function defaultResolveSettings() {
	return {
		includeTaggedNotes: true,
	};
}

function defaultDependencies() {
	return {
		originPath: "origin.md",
		relevantPaths: new Set<string>(),
		relevantLookupKeys: new Set<string>(),
		relevantTags: new Set<string>(),
		structuralSourcePaths: new Set<string>(),
	};
}

function setCachedResult(
	cache: ResolverCache,
	filePath: string,
	resolveSettings: ReturnType<typeof defaultResolveSettings>,
	dependencies: ReturnType<typeof defaultDependencies>,
	result: TwoHopLinkResult,
): void {
	cache.set(
		filePath,
		resolveSettings,
		createTwoHopResolveSnapshot(freezeTwoHopLinkResult(result), dependencies),
	);
}

function getCachedResult(
	cache: ResolverCache,
	filePath: string,
	resolveSettings: ReturnType<typeof defaultResolveSettings>,
): TwoHopLinkResult | undefined {
	return cache.getSnapshot(filePath, resolveSettings)?.result;
}

describe("ResolverCache", () => {
	test("returns cached result when settings match", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		const cached = getCachedResult(cache, "origin.md", defaultResolveSettings());

		expect(cached).toEqual(result);
		expect(cached).toBe(result);
		expect(getCachedResult(cache, "origin.md", defaultResolveSettings())).toBe(
			cached,
		);
	});

	test("miss when includeTaggedNotes differs", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		const cached = getCachedResult(cache, "origin.md", {
			includeTaggedNotes: false,
		});

		expect(cached).toBeUndefined();
	});

	test("evicts only relevant cache by affectedPaths", () => {
		const cache = new ResolverCache();
		const resultA = createMockResult();
		const resultB = createMockResult();

		setCachedResult(
			cache,
			"a.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantPaths: new Set(["note1.md"]),
			},
			resultA,
		);
		setCachedResult(
			cache,
			"b.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantPaths: new Set(["note2.md"]),
			},
			resultB,
		);

		cache.invalidate({
			affectedPaths: ["note1.md"],
		});

		expect(
			getCachedResult(cache, "a.md", defaultResolveSettings()),
		).toBeUndefined();
		expect(getCachedResult(cache, "b.md", defaultResolveSettings())).toEqual(
			resultB,
		);
	});

	test("evicts only relevant cache by affectedLookupKeys", () => {
		const cache = new ResolverCache();
		const resultA = createMockResult();
		const resultB = createMockResult();

		setCachedResult(
			cache,
			"a.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantLookupKeys: new Set(["missing-note.md"]),
			},
			resultA,
		);
		setCachedResult(
			cache,
			"b.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantLookupKeys: new Set(["other-missing.md"]),
			},
			resultB,
		);

		cache.invalidate({
			affectedLookupKeys: ["missing-note.md"],
		});

		expect(
			getCachedResult(cache, "a.md", defaultResolveSettings()),
		).toBeUndefined();
		expect(getCachedResult(cache, "b.md", defaultResolveSettings())).toEqual(
			resultB,
		);
	});

	test("evicts only relevant cache by affectedTags", () => {
		const cache = new ResolverCache();
		const resultA = createMockResult();
		const resultB = createMockResult();

		setCachedResult(
			cache,
			"a.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantTags: new Set(["tag1"]),
			},
			resultA,
		);
		setCachedResult(
			cache,
			"b.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantTags: new Set(["tag2"]),
			},
			resultB,
		);

		cache.invalidate({
			affectedTags: ["tag1"],
		});

		expect(
			getCachedResult(cache, "a.md", defaultResolveSettings()),
		).toBeUndefined();
		expect(getCachedResult(cache, "b.md", defaultResolveSettings())).toEqual(
			resultB,
		);
	});

	test("retains cache on unrelated update", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			{
				...defaultDependencies(),
				relevantPaths: new Set(["note1.md"]),
				relevantLookupKeys: new Set(["lookup1.md"]),
				relevantTags: new Set(["tag1"]),
			},
			result,
		);

		cache.invalidate({
			affectedPaths: ["unrelated.md"],
			affectedLookupKeys: ["unrelated-lookup.md"],
			affectedTags: ["unrelated-tag"],
		});

		const cached = getCachedResult(cache, "origin.md", defaultResolveSettings());

		expect(cached).toEqual(result);
	});

	test("clears on affectsAll", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		cache.invalidate({
			affectsAll: true,
		});

		expect(
			getCachedResult(cache, "origin.md", defaultResolveSettings()),
		).toBeUndefined();
	});

	test("clears when no context", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		cache.invalidate();

		expect(
			getCachedResult(cache, "origin.md", defaultResolveSettings()),
		).toBeUndefined();
	});

	test("clears when affected set is empty", () => {
		const cache = new ResolverCache();
		const result = createMockResult();

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		cache.invalidate({
			affectedPaths: [],
			affectedLookupKeys: [],
			affectedTags: [],
		});

		expect(
			getCachedResult(cache, "origin.md", defaultResolveSettings()),
		).toBeUndefined();
	});

	test("stores the completed immutable snapshot without copying it", () => {
		const cache = new ResolverCache();
		const result = createMockResult();
		const dependencies = {
			...defaultDependencies(),
			relevantPaths: new Set(["note1.md"]),
		};
		const snapshot = createTwoHopResolveSnapshot(
			freezeTwoHopLinkResult(result),
			dependencies,
		);

		cache.set("origin.md", defaultResolveSettings(), snapshot);

		const cachedSnapshot = cache.getSnapshot("origin.md", defaultResolveSettings());
		expect(cachedSnapshot).toBe(snapshot);
		expect(cachedSnapshot?.result).toBe(result);
		expect(Object.isFrozen(cachedSnapshot?.result)).toBe(true);
		expect(Object.isFrozen(cachedSnapshot?.result.backlinks)).toBe(true);

		cache.invalidate({
			affectedPaths: ["note1.md"],
		});
		expect(
			getCachedResult(cache, "origin.md", defaultResolveSettings()),
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
		};

		setCachedResult(
			cache,
			"origin.md",
			defaultResolveSettings(),
			defaultDependencies(),
			result,
		);

		const cached = getCachedResult(cache, "origin.md", defaultResolveSettings())!;
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
		expect(Object.isFrozen(sourceFile)).toBe(false);
		expect(Object.isFrozen(position)).toBe(false);
	});
});
