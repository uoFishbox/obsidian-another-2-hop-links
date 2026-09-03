import { describe, expect, it, vi } from "vitest";
import type { CachedMetadataWithLinkReferences, IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch, TwoHopLinkResult } from "two-hop/model";
import type { MergedLinkItem } from "../displayDataBuilder";
import { createDisplayDataBuilder } from "../displayDataBuilder";
import { getRelevanceLinkTargets, sortOneHopByRelevance } from "../relevanceSort";
import { MetricProvider } from "cards/sorting/MetricProvider";
import { SortService } from "cards/sorting/SortService";
import { DEFAULT_SETTINGS } from "settings/model";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";

function createScenario(
	definitions: { path: string; links?: string[]; mtime?: number }[],
) {
	const environment = new VaultEnvironmentBuilder(definitions).build();
	for (const definition of definitions) {
		environment.files[definition.path].stat.mtime = definition.mtime ?? 1;
	}
	const sortService = new SortService(
		new MetricProvider(
			environment.mockMetadataCache,
			environment.mockVault,
			environment.service,
			() => DEFAULT_SETTINGS,
		),
	);
	const getLinkTargets = vi.fn((path: string) =>
		getRelevanceLinkTargets(
			path,
			environment.mockMetadataCache,
			environment.mockVault,
		),
	);
	const branch = (path: string): TwoHopLinkBranch => ({
		hop1: {
			path,
			rawText: path,
			lookupPath: path,
			isUnresolved: false,
			sourceFile: environment.files["origin.md"],
		},
		hop2: [],
	});
	const backlink = (path: string): IndexedLink => ({
		path,
		rawText: "origin",
		lookupPath: "origin.md",
		isUnresolved: false,
		sourceFile: environment.files[path],
	});
	return { ...environment, sortService, getLinkTargets, branch, backlink };
}

function paths(items: readonly MergedLinkItem[]): (string | undefined)[] {
	return items.map((item) =>
		"hop1" in item ? item.hop1.path : item.sourceFile.path,
	);
}

describe("one-hop relevance", () => {
	it("puts a forward link with zero points before a backlink with twenty shared links", () => {
		const shared = Array.from({ length: 20 }, (_, i) => `shared-${i}`);
		const scenario = createScenario([
			{ path: "origin.md", links: ["forward", ...shared] },
			{ path: "forward.md", mtime: 1 },
			{ path: "back.md", links: ["origin", ...shared], mtime: 100 },
		]);
		const items = [scenario.backlink("back.md"), scenario.branch("forward.md")];
		expect(
			paths(
				sortOneHopByRelevance(
					items,
					"origin.md",
					scenario.getLinkTargets,
					scenario.sortService,
				),
			),
		).toEqual(["forward.md", "back.md"]);
	});

	it("counts unique shared and origin links equally, then orders ties by modified time", () => {
		const scenario = createScenario([
			{ path: "origin.md", links: ["a", "b", "c", "x", "y", "missing"] },
			{ path: "a.md", links: ["origin", "x", "x", "unrelated"], mtime: 10 },
			{ path: "b.md", links: ["x", "y"], mtime: 20 },
			{
				path: "c.md",
				links: ["missing", "missing", "missing", "other"],
				mtime: 100,
			},
		]);
		const items = [
			scenario.branch("c.md"),
			scenario.branch("a.md"),
			scenario.branch("b.md"),
		];
		const sorted = sortOneHopByRelevance(
			items,
			"origin.md",
			scenario.getLinkTargets,
			scenario.sortService,
		);
		expect(paths(sorted)).toEqual(["b.md", "a.md", "c.md"]);
		expect(paths(items)).toEqual(["c.md", "a.md", "b.md"]);
		expect(
			sortOneHopByRelevance(
				sorted,
				"origin.md",
				scenario.getLinkTargets,
				scenario.sortService,
			),
		).toBe(sorted);
	});

	it("uses updated order for backlinks to an origin that does not exist", () => {
		const scenario = createScenario([
			{ path: "a.md", links: ["missing", "missing"], mtime: 1 },
			{ path: "b.md", links: ["missing"], mtime: 10 },
		]);
		expect(
			paths(
				sortOneHopByRelevance(
					[scenario.backlink("a.md"), scenario.backlink("b.md")],
					"missing.md",
					scenario.getLinkTargets,
					scenario.sortService,
				),
			),
		).toEqual(["b.md", "a.md"]);
	});

	it("normalizes aliases, anchors, embeds, frontmatter and unresolved targets without counting tags", () => {
		const scenario = createScenario([
			{ path: "origin.md" },
			{ path: "folder/target.md" },
		]);
		const reference = (link: string) => ({
			link,
			original: `[[${link}]]`,
			key: "related",
		});
		const metadata: CachedMetadataWithLinkReferences = {
			frontmatterLinks: [
				reference("alias#heading"),
				reference("folder/target"),
				reference("Missing#block"),
				reference("missing"),
			],
			tags: [
				{
					tag: "#ignored",
					position: {
						start: { line: 0, col: 0, offset: 0 },
						end: { line: 0, col: 8, offset: 8 },
					},
				},
			],
			embeds: [
				{
					link: "folder/target",
					original: "![[folder/target]]",
					position: {
						start: { line: 1, col: 0, offset: 9 },
						end: { line: 1, col: 10, offset: 19 },
					},
				},
			],
		};
		scenario.mockMetadataCache.getFileCache.mockReturnValue(metadata);
		scenario.mockMetadataCache.getFirstLinkpathDest.mockImplementation((link) =>
			link === "alias" || link === "folder/target"
				? scenario.files["folder/target.md"]
				: null,
		);
		expect([...scenario.getLinkTargets("origin.md")]).toEqual([
			"folder/target.md",
			"missing.md",
		]);
		expect(scenario.mockVault.cachedRead).not.toHaveBeenCalled();
	});

	it.each([true, false])(
		"sorts merged/separate one-hop sections and keeps hop2 in updated order (merged=%s)",
		(merged) => {
			const scenario = createScenario([
				{ path: "origin.md", links: ["a", "b", "hidden.png"] },
				{ path: "a.md", links: ["hidden.png"], mtime: 1 },
				{ path: "b.md", mtime: 10 },
				{ path: "old.md", links: ["origin", "a", "b"], mtime: 2 },
				{ path: "new.md", links: ["origin"], mtime: 20 },
				{ path: "hidden.png" },
			]);
			let version = 0;
			const builder = createDisplayDataBuilder({
				...scenario,
				getSortContextVersion: () => version,
			});
			const hop2 = [scenario.backlink("old.md"), scenario.backlink("new.md")];
			const result: TwoHopLinkResult = {
				originFile: scenario.files["origin.md"],
				branches: [
					{ ...scenario.branch("a.md"), hop2 },
					scenario.branch("b.md"),
					scenario.branch("hidden.png"),
				],
				backlinks: hop2,
				taggedNotes: [],
			};
			const settings = {
				...DEFAULT_SETTINGS,
				useMergedLinksSection: merged,
				excludeAttachments: true,
				dedupeCards: false,
			};
			const preprocessed = {
				...builder.preprocessLinkDisplayData(result, settings).data,
				rawTagGroups: [],
			};
			const displayed = builder.sortAndAssembleDisplayData(
				preprocessed,
				settings,
				"relevance",
			);
			expect(
				paths(
					merged
						? displayed.mergedItems
						: [...displayed.outgoing, ...displayed.backlinks],
				),
			).toEqual(["a.md", "b.md", "old.md", "new.md"]);
			expect(paths(builder.getSortedTwoHopItems(hop2, "relevance"))).toEqual([
				"new.md",
				"old.md",
			]);
			const tagItems = hop2.map((item) => ({
				file: item.sourceFile,
				path: item.sourceFile.path,
				commonTags: ["tag"],
			}));
			const sortSpy = vi.spyOn(scenario.sortService, "sort");
			expect(builder.getSortedTwoHopItems(hop2, "modified-date-reverse")).toBe(
				builder.getSortedTwoHopItems(hop2, "relevance"),
			);
			expect(sortSpy).not.toHaveBeenCalled();
			expect(
				builder
					.getSortedTagGroupItems(tagItems, "relevance")
					.map((item) => item.path),
			).toEqual(["new.md", "old.md"]);
			sortSpy.mockClear();
			expect(
				builder.getSortedTagGroupItems(tagItems, "modified-date-reverse"),
			).toBe(builder.getSortedTagGroupItems(tagItems, "relevance"));
			expect(sortSpy).not.toHaveBeenCalled();
			expect(
				builder.sortAndAssembleDisplayData(preprocessed, settings, "relevance"),
			).toBe(displayed);

			// Change links without changing the preprocessed card arrays.
			scenario.mockMetadataCache.getFileCache.mockReturnValue(null);
			scenario.sortService.invalidateCache();
			version += 1;
			const refreshed = builder.sortAndAssembleDisplayData(
				preprocessed,
				settings,
				"relevance",
			);
			expect(paths(merged ? refreshed.mergedItems : refreshed.outgoing)).toEqual(
				merged ? ["new.md", "b.md", "old.md", "a.md"] : ["b.md", "a.md"],
			);
		},
	);
});
