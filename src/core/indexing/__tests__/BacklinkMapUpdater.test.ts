import { describe, test, expect, beforeEach } from "vitest";
import {
	createBacklinkUpdater,
	type BacklinkUpdater,
} from "../backlink-builder/backlinkUpdater";
import { getBacklinkCollectionCount } from "../backlink-builder/backlinkBuckets";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import type { CachedMetadata, TFile } from "obsidian";

function createPosition(offset: number) {
	return {
		start: { line: 0, col: 0, offset },
		end: { line: 0, col: 5, offset: offset + 5 },
	};
}

function createCachedMetadata(
	links: Array<{
		link: string;
		displayText?: string;
		offset: number;
	}>,
): CachedMetadata {
	return {
		links: links.map((link) => ({
			link: link.link,
			original: link.displayText
				? `[[${link.link}|${link.displayText}]]`
				: `[[${link.link}]]`,
			displayText: link.displayText,
			position: createPosition(link.offset),
		})),
		embeds: [],
		headings: [],
		sections: [],
		tags: [],
		frontmatter: undefined,
		frontmatterPosition: undefined,
		frontmatterLinks: undefined,
	} as CachedMetadata;
}

describe("BacklinkMapUpdater", () => {
	let builder: VaultEnvironmentBuilder;
	let updater: BacklinkUpdater;
	let env: ReturnType<VaultEnvironmentBuilder["build"]>;

	beforeEach(() => {
		builder = new VaultEnvironmentBuilder([
			{ path: "source1.md", links: ["target1", "target2"] },
			{ path: "source2.md", links: ["target1"] },
			{ path: "target1.md" },
			{ path: "target2.md" },
		]);
		env = builder.build();
		updater = createBacklinkUpdater(env.mockVault, env.mockMetadataCache);
	});

	test("removeBacklinksBySource notifies delete mutations", async () => {
		const backlinksMap = await builder.buildBacklinksMapAsync();
		const sourceFile = env.mockVault.getAbstractFileByPath("source1.md") as TFile;
		const sourceSummary = await updater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const mutations: Array<{
			lookupPath: string;
			lookupKey: string;
			sourcePath: string;
			hadResolved: boolean;
			isLookupPathEmptyAfter: boolean;
		}> = [];

		const affected = new Set<string>();
		await updater.removeBacklinksBySourceAsync(
			backlinksMap,
			"source1.md",
			sourceSummary,
			createImmediateYieldScheduler(),
			affected,
			(lookupPath, lookupKey, sourcePath, hadResolved, isLookupPathEmptyAfter) =>
				mutations.push({
					lookupPath,
					lookupKey,
					sourcePath,
					hadResolved,
					isLookupPathEmptyAfter,
				}),
		);

		expect([...affected].sort()).toEqual(["target1.md", "target2.md"]);
		expect(mutations).toEqual([
			{
				lookupKey: "target1.md",
				lookupPath: "target1.md",
				sourcePath: "source1.md",
				hadResolved: true,
				isLookupPathEmptyAfter: false,
			},
			{
				lookupKey: "target2.md",
				lookupPath: "target2.md",
				sourcePath: "source1.md",
				hadResolved: true,
				isLookupPathEmptyAfter: true,
			},
		]);
	});

	test("reconcileBacklinksBySource does not reapply unchanged destinations", async () => {
		const backlinksMap = await builder.buildBacklinksMapAsync();
		const sourceFile = env.mockVault.getAbstractFileByPath("source1.md") as TFile;
		const previousSummary = await updater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);

		builder.addFile({ path: "target3.md" });
		builder.addFile({ path: "source1.md", links: ["target1", "target3"] });

		const updatedSourceFile = env.mockVault.getAbstractFileByPath(
			"source1.md",
		) as TFile;
		const nextSummary = await updater.buildSourceSummaryForFileAsync(
			updatedSourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const removals: string[] = [];
		const additions: string[] = [];

		const result = await updater.reconcileBacklinksBySourceAsync(
			backlinksMap,
			"source1.md",
			previousSummary,
			nextSummary,
			createImmediateYieldScheduler(),
			(lookupPath) => removals.push(lookupPath),
			(lookupPath) => additions.push(lookupPath),
		);

		expect(result.affectedDestinations).toEqual(
			new Set(["target2.md", "target3.md"]),
		);
		expect(result.representativeChangedLookupKeys).toEqual(new Set());
		expect(removals).toEqual(["target2.md"]);
		expect(additions).toEqual(["target3.md"]);
		expect(backlinksMap.get("target1.md")?.has("source1.md")).toBe(true);
	});

	test("reconcileBacklinksBySource streams effects into an external sink", async () => {
		const backlinksMap = await builder.buildBacklinksMapAsync();
		const sourceFile = env.mockVault.getAbstractFileByPath("source1.md") as TFile;
		const previousSummary = await updater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);

		builder.addFile({ path: "target3.md" });
		builder.addFile({ path: "source1.md", links: ["target1", "target3"] });

		const updatedSourceFile = env.mockVault.getAbstractFileByPath(
			"source1.md",
		) as TFile;
		const nextSummary = await updater.buildSourceSummaryForFileAsync(
			updatedSourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const affectedDestinations = new Set<string>();
		const representativeChangedLookupKeys = new Set<string>();

		const changed = await updater.reconcileBacklinksBySourceAsync(
			backlinksMap,
			"source1.md",
			previousSummary,
			nextSummary,
			createImmediateYieldScheduler(),
			undefined,
			undefined,
			{
				markAffectedDestination(destinationPath) {
					affectedDestinations.add(destinationPath);
				},
				markRepresentativeChangedLookupKey(lookupKey) {
					representativeChangedLookupKeys.add(lookupKey);
				},
			},
		);

		expect(changed).toBe(true);
		expect(affectedDestinations).toEqual(new Set(["target2.md", "target3.md"]));
		expect(representativeChangedLookupKeys).toEqual(new Set());
	});

	test("reconcileBacklinksBySource does not remove/add on position-only changes", async () => {
		const customBuilder = new VaultEnvironmentBuilder([
			{ path: "source.md" },
			{ path: "target.md" },
		]);
		const { mockVault, mockMetadataCache } = customBuilder.build();
		const localUpdater = createBacklinkUpdater(mockVault, mockMetadataCache);
		const sourceFile = mockVault.getAbstractFileByPath("source.md") as TFile;

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return createCachedMetadata([
					{ link: "target", displayText: "alpha", offset: 10 },
				]);
			}
			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});

		const backlinksMap = await customBuilder.buildBacklinksMapAsync();
		const previousSummary = await localUpdater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return createCachedMetadata([
					{ link: "target", displayText: "alpha", offset: 90 },
				]);
			}
			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});

		const nextSummary = await localUpdater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const removals: string[] = [];
		const additions: string[] = [];

		const result = await localUpdater.reconcileBacklinksBySourceAsync(
			backlinksMap,
			"source.md",
			previousSummary,
			nextSummary,
			createImmediateYieldScheduler(),
			(lookupPath) => removals.push(lookupPath),
			(lookupPath) => additions.push(lookupPath),
		);

		expect(result.affectedDestinations).toEqual(new Set());
		expect(result.representativeChangedLookupKeys).toEqual(new Set());
		expect(removals).toEqual([]);
		expect(additions).toEqual([]);
		expect(
			getBacklinkCollectionCount(
				backlinksMap.get("target.md")?.get("source.md")!,
			),
		).toBe(1);
	});

	test("reconcileBacklinksBySource adds to affectedDestinations on order-only changes", async () => {
		const customBuilder = new VaultEnvironmentBuilder([
			{ path: "source.md" },
			{ path: "target.md" },
		]);
		const { mockVault, mockMetadataCache } = customBuilder.build();
		const localUpdater = createBacklinkUpdater(mockVault, mockMetadataCache);
		const sourceFile = mockVault.getAbstractFileByPath("source.md") as TFile;

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return createCachedMetadata([
					{ link: "target", displayText: "late", offset: 120 },
					{ link: "target", displayText: "early", offset: 10 },
				]);
			}
			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});

		const backlinksMap = await customBuilder.buildBacklinksMapAsync();
		const previousSummary = await localUpdater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return createCachedMetadata([
					{ link: "target", displayText: "late", offset: 5 },
					{ link: "target", displayText: "early", offset: 200 },
				]);
			}
			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});

		const nextSummary = await localUpdater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const removals: string[] = [];
		const additions: string[] = [];

		const result = await localUpdater.reconcileBacklinksBySourceAsync(
			backlinksMap,
			"source.md",
			previousSummary,
			nextSummary,
			createImmediateYieldScheduler(),
			(lookupPath) => removals.push(lookupPath),
			(lookupPath) => additions.push(lookupPath),
		);

		expect(result.affectedDestinations).toEqual(new Set(["target.md"]));
		expect(result.representativeChangedLookupKeys).toEqual(new Set(["target.md"]));
		expect(removals).toEqual([]);
		expect(additions).toEqual([]);
		expect(
			nextSummary?.orderedReferences[
				nextSummary.destinations.get("target.md")!.firstRefIndex
			]?.displayText,
		).toBe("late");
	});

	test("reconcileBacklinksBySource detects representative changes across sibling lookupPaths by lookupKey", async () => {
		const customBuilder = new VaultEnvironmentBuilder([{ path: "source.md" }]);
		const { mockVault, mockMetadataCache } = customBuilder.build();
		const localUpdater = createBacklinkUpdater(mockVault, mockMetadataCache);
		const sourceFile = mockVault.getAbstractFileByPath("source.md") as TFile;

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return createCachedMetadata([
					{ link: "Foo", offset: 10 },
					{ link: "foo", offset: 20 },
				]);
			}
			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});

		const backlinksMap = await customBuilder.buildBacklinksMapAsync();
		const previousSummary = await localUpdater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const removals: string[] = [];
		const additions: string[] = [];

		(mockMetadataCache.getFileCache as any).mockImplementation((file: TFile) => {
			if (file.path === "source.md") {
				return createCachedMetadata([
					{ link: "foo", offset: 10 },
					{ link: "Foo", offset: 20 },
				]);
			}
			return {
				links: [],
				embeds: [],
				headings: [],
				sections: [],
				tags: [],
				frontmatter: undefined,
				frontmatterPosition: undefined,
				frontmatterLinks: undefined,
			} as CachedMetadata;
		});

		const nextSummary = await localUpdater.buildSourceSummaryForFileAsync(
			sourceFile,
			undefined,
			createImmediateYieldScheduler(),
		);
		const result = await localUpdater.reconcileBacklinksBySourceAsync(
			backlinksMap,
			"source.md",
			previousSummary,
			nextSummary,
			createImmediateYieldScheduler(),
			(lookupPath) => removals.push(lookupPath),
			(lookupPath) => additions.push(lookupPath),
		);

		expect(result.affectedDestinations).toEqual(new Set());
		expect(result.representativeChangedLookupKeys).toEqual(new Set(["foo.md"]));
		expect(removals).toEqual([]);
		expect(additions).toEqual([]);
	});
});

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

function createSourceSummaryWithLookupKeys(
	lookupKeys: string[],
	destinations: Map<
		string,
		{ count: number; hasResolved: boolean; firstRefIndex: number }
	> = new Map(),
	orderedReferences: Array<{
		destinationPath: string;
		rawLookupKey: string;
		isUnresolved: boolean;
		rawText: string;
		displayText: string;
		key?: string;
	}> = [],
	firstRefIndexByLookupKey: Map<string, number> = new Map(),
) {
	for (const key of lookupKeys) {
		if (!firstRefIndexByLookupKey.has(key)) {
			firstRefIndexByLookupKey.set(key, 0);
		}
	}
	return {
		destinations,
		orderedReferences,
		firstRefIndexByLookupKey,
		lookupKeyToRawLinkPaths: new Map(),
		unresolvedLookupKeys: new Set<string>(),
		hasSourceDependentLinks: false,
	};
}

describe("BacklinkMapUpdater yield behavior", () => {
	test("reconcileBacklinksBySourceAsync yields during representative lookup key comparison", async () => {
		const customBuilder = new VaultEnvironmentBuilder([
			{ path: "source.md" },
			{ path: "target.md" },
		]);
		const { mockVault, mockMetadataCache } = customBuilder.build();
		const localUpdater = createBacklinkUpdater(mockVault, mockMetadataCache);

		const lookupKeyCount = 256;
		const lookupKeys: string[] = [];
		const firstRefIndexByLookupKey = new Map<string, number>();
		const orderedReferences: Array<{
			destinationPath: string;
			rawLookupKey: string;
			isUnresolved: boolean;
			rawText: string;
			displayText: string;
		}> = [];

		for (let i = 0; i < lookupKeyCount; i++) {
			const key = `lookup-${i}.md`;
			lookupKeys.push(key);
			firstRefIndexByLookupKey.set(key, i);
			orderedReferences.push({
				destinationPath: "target.md",
				rawLookupKey: key,
				isUnresolved: false,
				rawText: key,
				displayText: `ref-${i}`,
			});
		}

		const previousSummary = createSourceSummaryWithLookupKeys(
			lookupKeys,
			new Map([
				[
					"target.md",
					{
						count: lookupKeyCount,
						hasResolved: true,
						firstRefIndex: 0,
					},
				],
			]),
			orderedReferences,
			firstRefIndexByLookupKey,
		);

		const nextOrderedReferences = orderedReferences.map((ref, i) => ({
			...ref,
			displayText: i === 0 ? "changed" : ref.displayText,
		}));
		const nextSummary = createSourceSummaryWithLookupKeys(
			lookupKeys,
			new Map([
				[
					"target.md",
					{
						count: lookupKeyCount,
						hasResolved: true,
						firstRefIndex: 0,
					},
				],
			]),
			nextOrderedReferences,
			firstRefIndexByLookupKey,
		);

		const backlinksMap = await customBuilder.buildBacklinksMapAsync();
		const countingScheduler = createCountingYieldScheduler();

		const result = await localUpdater.reconcileBacklinksBySourceAsync(
			backlinksMap,
			"source.md",
			previousSummary,
			nextSummary,
			countingScheduler.scheduler,
			() => undefined,
			() => undefined,
		);

		expect(countingScheduler.yieldCalls).toBeGreaterThan(0);
		expect(result.representativeChangedLookupKeys.has("lookup-0.md")).toBe(true);
	});
});
