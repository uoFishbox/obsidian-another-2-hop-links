import { describe, test, expect, vi } from "vitest";
import { TwoHopLinkResolver } from "../TwoHopLinkResolver";
import { IndexingService } from "core/indexing/index-service/IndexingService";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import type {
	ResolveProgress,
	TwoHopLinkResult,
	TwoHopIndexedLink,
} from "types/domain";
import type { IIndexingService } from "types/services";
import type {
	ResolverDebugPolicy,
	ResolverPerformanceSettings,
} from "../ResolverTypes";

type ResolverEnvironment = ReturnType<VaultEnvironmentBuilder["build"]>;

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createResolver(
	env: ResolverEnvironment,
	indexingService: IIndexingService = env.service,
	options?: {
		performance?: () => Partial<ResolverPerformanceSettings>;
		debug?: () => ResolverDebugPolicy;
	},
): TwoHopLinkResolver {
	return new TwoHopLinkResolver(
		env.mockMetadataCache,
		env.mockVault,
		indexingService,
		options?.performance,
		options?.debug,
	);
}

async function buildResolvedEnvironment(
	definitions: ConstructorParameters<typeof VaultEnvironmentBuilder>[0],
) {
	const env = new VaultEnvironmentBuilder(definitions).build();
	await env.service.rebuildIndexesTimeSliced();
	return {
		...env,
		resolver: createResolver(env),
	};
}

function branchFor(result: TwoHopLinkResult, hop1Path: string) {
	return result.branches.find((branch) => branch.hop1.path === hop1Path);
}

function sourcePaths(links: TwoHopIndexedLink[]): string[] {
	return links.map((link) => link.sourceFile.path).sort();
}

function createIndexingServiceWithoutSubscription(
	service: IndexingService,
): IIndexingService {
	return {
		getBacklinksMap: () => service.getBacklinksMap(),
		invalidateAll: () => service.invalidateAll(),
		getSourcePathsForLookupKeys: (lookupKeys) =>
			service.getSourcePathsForLookupKeys(lookupKeys),
		getBacklinksForLink: (linkPath) => service.getBacklinksForLink(linkPath),
		getUniqueBacklinkSourcesForLink: (linkPath, excludePath, limit) =>
			service.getUniqueBacklinkSourcesForLink(linkPath, excludePath, limit),
		getBacklinkCountForLink: (linkPath) =>
			service.getBacklinkCountForLink(linkPath),
		getIndexVersion: () => service.getIndexVersion(),
		peekNotesWithCommonTags: (file) => service.peekNotesWithCommonTags(file),
		getNotesWithCommonTags: (file) => service.getNotesWithCommonTags(file),
		getNotesWithTag: (tag, sourcePath) => service.getNotesWithTag(tag, sourcePath),
		awaitIdle: () => service.awaitIdle(),
		isUnresolvedWithSingleBacklink: (lookupPath) =>
			service.isUnresolvedWithSingleBacklink(lookupPath),
		isUnresolvedWithSingleBacklinkBatch: (lookupPaths) =>
			service.isUnresolvedWithSingleBacklinkBatch(lookupPaths),
	} as IIndexingService;
}

describe("TwoHopLinkResolver", () => {
	describe("resolve behavior", () => {
		test("creates a branch for each origin outgoing link and puts backlink sources for each hop1 into hop2", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1", "note2"] },
				{ path: "note1.md" },
				{ path: "note2.md" },
				{ path: "backlink1.md", links: ["note1"] },
				{ path: "backlink2.md", links: ["note2"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			expect(result.originFile).toBe(files["origin.md"]);
			expect(result.branches).toHaveLength(2);

			expect(sourcePaths(branchFor(result, "note1.md")!.hop2)).toEqual([
				"backlink1.md",
			]);
			expect(sourcePaths(branchFor(result, "note2.md")!.hop2)).toEqual([
				"backlink2.md",
			]);
		});

		test("returns backlinks to origin", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md" },
				{ path: "backlink1.md", links: ["origin"] },
				{ path: "backlink2.md", links: ["origin"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			const backlinkPaths = result.backlinks.map((link) => link.sourceFile.path);
			expect(backlinkPaths).toContain("backlink1.md");
			expect(backlinkPaths).toContain("backlink2.md");
		});

		test("returns common tags as taggedNotes", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", tags: ["tag1"] },
				{ path: "tagged1.md", tags: ["tag1"] },
				{ path: "tagged2.md", tags: ["tag1", "tag2"] },
				{ path: "tagged3.md", tags: ["tag2"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			const taggedPaths = result.taggedNotes.map((note) => note.path).sort();
			expect(taggedPaths).toEqual(["tagged1.md", "tagged2.md"]);
		});

		test("hop1 / hop2 pointing to origin itself are excluded", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["origin", "other"] },
				{ path: "other.md" },
				{ path: "note1.md", links: ["other", "origin"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			expect(
				result.branches.find((b) => b.hop1.path === "origin.md"),
			).toBeUndefined();
			expect(result.branches).toHaveLength(1);
			expect(result.branches[0].hop1.path).toBe("other.md");
			expect(result.branches[0].hop2.map((l) => l.sourceFile.path)).not.toContain(
				"origin.md",
			);
		});

		test("duplicate hop1 is merged into one branch", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1", "note1"] },
				{ path: "note1.md" },
				{ path: "backlink1.md", links: ["note1"] },
				{ path: "backlink2.md", links: ["note1"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			expect(result.branches).toHaveLength(1);
			expect(result.branches[0].hop1.path).toBe("note1.md");
			expect(sourcePaths(result.branches[0].hop2)).toEqual([
				"backlink1.md",
				"backlink2.md",
			]);
		});

		test("duplicate hop2 sources are merged into one", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"] },
				{ path: "note1.md" },
				{ path: "backlink.md", links: ["note1"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			const uniqueSourcePaths = new Set(
				result.branches[0].hop2.map((link) => link.sourceFile.path),
			);
			expect(uniqueSourcePaths).toContain("backlink.md");
		});

		test("branches are empty when there are no outgoing links", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md" },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			expect(result.branches).toHaveLength(0);
		});

		test("hop2 is empty when there is no hop2", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"] },
				{ path: "note1.md" },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			expect(result.branches).toHaveLength(1);
			expect(result.branches[0].hop1.path).toBe("note1.md");
			expect(result.branches[0].hop2).toHaveLength(0);
		});

		test("unresolved hop1 retains the lookupPath", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["missing-note"] },
			]);

			const result = await resolver.resolve(files["origin.md"]);

			expect(result.branches).toHaveLength(1);
			expect(result.branches[0].hop1.isUnresolved).toBe(true);
			expect(result.branches[0].hop1.path).toBeUndefined();
			expect(result.branches[0].hop1.lookupPath).toBe("missing-note.md");
		});
	});

	describe("progress", () => {
		test("progress fills results incrementally in base -> twohop -> complete order", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"], tags: ["tag1"] },
				{ path: "note1.md" },
				{ path: "backlink.md", links: ["note1"] },
				{ path: "tagged.md", tags: ["tag1"] },
			]);

			const events: ResolveProgress[] = [];
			const result = await resolver.resolve(files["origin.md"], (progress) => {
				events.push(progress);
			});

			expect(events.map((event) => event.phase)).toEqual([
				"base",
				"twohop",
				"complete",
			]);

			expect(events[0].data.branches[0].hop2).toEqual([]);
			expect(events[0].data.taggedNotes).toEqual([]);

			expect(sourcePaths(events[1].data.branches[0].hop2)).toEqual([
				"backlink.md",
			]);
			expect(events[1].data.taggedNotes).toEqual([]);

			expect(events[2].data).toBe(result);
			expect(events[2].data.taggedNotes.map((note) => note.path)).toEqual([
				"tagged.md",
			]);
		});

		test("displayVersions shows links and tags readiness state per phase", async () => {
			const { resolver, files } = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"], tags: ["tag1"] },
				{ path: "note1.md" },
				{ path: "backlink.md", links: ["note1"] },
				{ path: "tagged.md", tags: ["tag1"] },
			]);

			const events: ResolveProgress[] = [];
			await resolver.resolve(files["origin.md"], (progress) => {
				events.push(progress);
			});

			expect(events[0].data.displayVersions).toMatchObject({
				links: expect.stringMatching(/:base$/),
				tags: expect.stringMatching(/:pending$/),
			});

			expect(events[1].data.displayVersions).toMatchObject({
				links: expect.stringMatching(/:twohop$/),
				tags: expect.stringMatching(/:pending$/),
			});

			expect(events[2].data.displayVersions).toMatchObject({
				links: expect.stringMatching(/:twohop$/),
				tags: expect.stringMatching(/:tags$/),
			});
		});
	});

	describe("cache and updates", () => {
		test("concurrent same-file resolve shares the same in-flight result", async () => {
			const env = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"] },
				{ path: "note1.md" },
			]);

			const idleDeferred = createDeferred<void>();
			const awaitIdleSpy = vi
				.spyOn(env.service, "awaitIdle")
				.mockReturnValue(idleDeferred.promise);

			const resolver = createResolver(env);
			const first = resolver.resolve(env.files["origin.md"]);
			const second = resolver.resolve(env.files["origin.md"]);
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});

			expect(awaitIdleSpy).toHaveBeenCalledTimes(1);

			idleDeferred.resolve();
			const [firstResult, secondResult] = await Promise.all([first, second]);
			expect(firstResult).toBe(secondResult);
		});

		test("resolver with data update subscription can return warm cache before idle", async () => {
			const env = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"] },
				{ path: "note1.md" },
			]);

			const resolver = createResolver(env);
			const firstResult = await resolver.resolve(env.files["origin.md"]);

			const idleDeferred = createDeferred<void>();
			vi.spyOn(env.service, "awaitIdle").mockReturnValue(idleDeferred.promise);

			const secondResultPromise = resolver.resolve(env.files["origin.md"]);
			await Promise.resolve();

			await expect(secondResultPromise).resolves.toEqual(firstResult);
		});

		test("resolver without data update subscription returns warm cache after idle", async () => {
			const env = await buildResolvedEnvironment([
				{ path: "origin.md", links: ["note1"] },
				{ path: "note1.md" },
			]);

			const indexingService = createIndexingServiceWithoutSubscription(
				env.service,
			);
			const resolver = createResolver(env, indexingService);

			const firstResult = await resolver.resolve(env.files["origin.md"]);

			const idleDeferred = createDeferred<void>();
			vi.spyOn(indexingService, "awaitIdle").mockReturnValueOnce(
				idleDeferred.promise,
			);

			const secondResultPromise = resolver.resolve(env.files["origin.md"]);

			let settled = false;
			void secondResultPromise.then(() => {
				settled = true;
			});

			await Promise.resolve();
			expect(settled).toBe(false);

			idleDeferred.resolve();

			await expect(secondResultPromise).resolves.toEqual(firstResult);
		});

		test("taggedNotes are updated after affectedTags update", async () => {
			const builder = new VaultEnvironmentBuilder([
				{ path: "origin.md", tags: ["tag1"] },
				{ path: "tagged.md", tags: ["tag1"] },
				{ path: "unrelated.md", tags: ["tag2"] },
			]);
			const env = builder.build();
			await env.service.rebuildIndexesTimeSliced();

			const resolver = createResolver(env);

			const initial = await resolver.resolve(env.files["origin.md"]);
			expect(initial.taggedNotes.map((note) => note.path)).toEqual(["tagged.md"]);

			builder.addFile({ path: "unrelated.md", tags: ["tag1"] });
			await env.service.applyFileChangesTimeSliced([
				{ type: "modify", path: "unrelated.md" },
			]);

			const updated = await resolver.resolve(env.files["origin.md"]);
			expect(updated.taggedNotes.map((note) => note.path).sort()).toEqual([
				"tagged.md",
				"unrelated.md",
			]);
		});

		test("results are separated for includeTaggedNotes=false and true", async () => {
			const env = await buildResolvedEnvironment([
				{ path: "origin.md", tags: ["tag1"] },
				{ path: "tagged.md", tags: ["tag1"] },
			]);

			const resolver = createResolver(env);

			const hiddenResult = await resolver.resolve(
				env.files["origin.md"],
				undefined,
				{
					includeTaggedNotes: false,
				},
			);
			expect(hiddenResult.taggedNotes).toEqual([]);

			const visibleResult = await resolver.resolve(
				env.files["origin.md"],
				undefined,
				{
					includeTaggedNotes: true,
				},
			);
			expect(visibleResult.taggedNotes.map((note) => note.path)).toEqual([
				"tagged.md",
			]);
		});
	});
});
