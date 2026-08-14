import { describe, expect, test } from "vitest";
import {
	createCreateChangePlanner,
	createCreateEventEvaluationCache,
} from "../index-service/createChangePlanner";
import { buildIndexSnapshotAsync } from "./snapshotTestHelpers";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";

describe("CreateChangePlanner", () => {
	test("create includes both unresolved and shadowing candidates for reprocessing", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "other/unresolved-source.md", links: ["src/note"] },
			{ path: "archive/note.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		const planner = createCreateChangePlanner(env.mockVault, env.mockMetadataCache);

		env.builder.addFile({ path: "src/note.md" });
		installShadowingResolver(env.mockVault, env.mockMetadataCache);

		const pathsToUpdate = new Set<string>();
		await planner.collectPathsForCreateEventAsync(
			snapshot,
			"src/note.md",
			pathsToUpdate,
			createCreateEventEvaluationCache(),
			createImmediateYieldScheduler(),
		);

		expect(pathsToUpdate).toEqual(
			new Set(["src/note.md", "src/origin.md", "other/unresolved-source.md"]),
		);
	});

	test("create shadowing detection does not rescan metadata cache when sourceSummary exists", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "src/origin.md", links: ["note"] },
			{ path: "archive/note.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		const planner = createCreateChangePlanner(env.mockVault, env.mockMetadataCache);
		const sourceSummary = snapshot.sourceSummaries.get("src/origin.md");

		expect(sourceSummary?.lookupKeyToRawLinkPaths).toEqual(
			new Map([["note.md", "note"]]),
		);
		if (sourceSummary) {
			(sourceSummary as unknown as { orderedReferences: [] }).orderedReferences =
				[];
		}

		env.builder.addFile({ path: "src/note.md" });
		installShadowingResolver(env.mockVault, env.mockMetadataCache);
		env.mockMetadataCache.getFileCache.mockClear();

		const pathsToUpdate = new Set<string>();
		await planner.collectPathsForCreateEventAsync(
			snapshot,
			"src/note.md",
			pathsToUpdate,
			createCreateEventEvaluationCache(),
			createImmediateYieldScheduler(),
		);

		expect(pathsToUpdate).toEqual(new Set(["src/note.md", "src/origin.md"]));
		expect(env.mockMetadataCache.getFileCache).not.toHaveBeenCalled();
	});

	test("create falls back to metadata when a reverse-index source has no summary", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "origin.md", links: ["missing"] },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		const planner = createCreateChangePlanner(env.mockVault, env.mockMetadataCache);

		snapshot.sourceSummaries.delete("origin.md");
		env.builder.addFile({ path: "missing.md" });
		env.mockMetadataCache.getFileCache.mockClear();

		const pathsToUpdate = new Set<string>();
		await planner.collectPathsForCreateEventAsync(
			snapshot,
			"missing.md",
			pathsToUpdate,
			createCreateEventEvaluationCache(),
			createImmediateYieldScheduler(),
		);

		expect(pathsToUpdate).toEqual(new Set(["missing.md", "origin.md"]));
		expect(env.mockMetadataCache.getFileCache).toHaveBeenCalledTimes(1);
	});

	test("create shadowing detection shares resolved destination cache within the same directory", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "team-a/one.md", links: ["Dashboard"] },
			{ path: "team-a/two.md", links: ["Dashboard"] },
			{ path: "team-b/one.md", links: ["Dashboard"] },
			{ path: "archive/Dashboard.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		const planner = createCreateChangePlanner(env.mockVault, env.mockMetadataCache);
		const cache = createCreateEventEvaluationCache();

		env.builder.addFile({ path: "team-a/Dashboard.md" });
		env.builder.addFile({ path: "team-b/Dashboard.md" });

		(env.mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
			(linkText: string, sourcePath: string) => {
				if (linkText !== "Dashboard") {
					return null;
				}

				if (sourcePath.startsWith("team-a/")) {
					return env.mockVault.getAbstractFileByPath("team-a/Dashboard.md");
				}

				return env.mockVault.getAbstractFileByPath("team-b/Dashboard.md");
			},
		);
		env.mockMetadataCache.getFirstLinkpathDest.mockClear();
		expect(
			await planner.sourceHasLinkResolvingToCreatedFileAsync(
				snapshot,
				"team-a/one.md",
				"team-a/Dashboard.md",
				new Set(["dashboard.md"]),
				cache,
				createImmediateYieldScheduler(),
			),
		).toBe(true);
		expect(
			await planner.sourceHasLinkResolvingToCreatedFileAsync(
				snapshot,
				"team-a/two.md",
				"team-a/Dashboard.md",
				new Set(["dashboard.md"]),
				cache,
				createImmediateYieldScheduler(),
			),
		).toBe(true);
		expect(
			await planner.sourceHasLinkResolvingToCreatedFileAsync(
				snapshot,
				"team-b/one.md",
				"team-b/Dashboard.md",
				new Set(["dashboard.md"]),
				cache,
				createImmediateYieldScheduler(),
			),
		).toBe(true);

		expect(env.mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
		expect(cache.resolvedDestinations.size).toBe(2);
		expect(cache.resolvedDestinations.get("team-a")?.get("Dashboard")).toBe(
			"team-a/Dashboard.md",
		);
		expect(cache.resolvedDestinations.get("team-b")?.get("Dashboard")).toBe(
			"team-b/Dashboard.md",
		);
	});
});

function installShadowingResolver(mockVault: any, mockMetadataCache: any): void {
	(mockMetadataCache.getFirstLinkpathDest as any).mockImplementation(
		(linkText: string, sourcePath: string) => {
			if (sourcePath === "src/origin.md" && linkText === "note") {
				return (
					mockVault.getAbstractFileByPath("src/note.md") ??
					mockVault.getAbstractFileByPath("archive/note.md")
				);
			}

			const normalized = linkText.endsWith(".md") ? linkText : `${linkText}.md`;
			return mockVault.getAbstractFileByPath(normalized);
		},
	);
}

function createImmediateYieldScheduler() {
	return {
		checkpoint: () => undefined,
	};
}
