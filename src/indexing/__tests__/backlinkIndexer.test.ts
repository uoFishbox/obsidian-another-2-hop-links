import { describe, expect, test } from "vitest";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { buildLinkIndexArtifactsChunked } from "../backlink-builder/backlinkIndexer";
import { resolvedEdgeKey, unresolvedEdgeKey } from "../link-index/linkIndex";

describe("buildLinkIndexArtifactsChunked", () => {
	test("scans parsed file metadata without requiring completed host link maps", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target", "target", "missing"] },
			{ path: "target.md" },
		]).build();
		env.mockMetadataCache.resolvedLinks = {};
		env.mockMetadataCache.unresolvedLinks = {};

		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		expect(env.mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
		expect(
			artifacts.linkIndex.incoming
				.get(resolvedEdgeKey("target.md"))
				?.get("source.md"),
		).toBe(2);
		expect(
			artifacts.linkIndex.incoming
				.get(unresolvedEdgeKey("missing"))
				?.get("source.md"),
		).toBe(1);
		expect(artifacts.linkIndex.outgoing.get("source.md")).toHaveLength(2);
	});

	test("reuses unambiguous link resolution across source files", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "first-source.md", links: ["target"] },
			{ path: "second-source.md", links: ["target"] },
			{ path: "target.md" },
		]).build();

		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		expect(env.mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(1);
		expect(artifacts.linkIndex.incoming.get(resolvedEdgeKey("target.md"))).toEqual(
			new Map([
				["first-source.md", 1],
				["second-source.md", 1],
			]),
		);
	});

	test("resolves ambiguous basenames separately for each source file", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "folder-a/source.md", links: ["target"] },
			{ path: "folder-b/source.md", links: ["target"] },
			{ path: "folder-a/target.md" },
			{ path: "folder-b/target.md" },
		]).build();
		env.mockMetadataCache.getFirstLinkpathDest.mockImplementation(
			(_linkPath, sourcePath) =>
				sourcePath.startsWith("folder-a/")
					? env.files["folder-a/target.md"]
					: env.files["folder-b/target.md"],
		);

		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		expect(env.mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
		expect(
			artifacts.linkIndex.incoming
				.get(resolvedEdgeKey("folder-a/target.md"))
				?.get("folder-a/source.md"),
		).toBe(1);
		expect(
			artifacts.linkIndex.incoming
				.get(resolvedEdgeKey("folder-b/target.md"))
				?.get("folder-b/source.md"),
		).toBe(1);
	});

	test("resolves relative link paths separately for each source file", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "folder-a/source.md", links: ["./target"] },
			{ path: "folder-b/source.md", links: ["./target"] },
			{ path: "folder-a/target.md" },
			{ path: "folder-b/target.md" },
		]).build();
		env.mockMetadataCache.getFirstLinkpathDest.mockImplementation(
			(_linkPath, sourcePath) =>
				sourcePath.startsWith("folder-a/")
					? env.files["folder-a/target.md"]
					: env.files["folder-b/target.md"],
		);

		const artifacts = await buildLinkIndexArtifactsChunked(
			env.mockVault,
			env.mockMetadataCache,
			{},
		);

		expect(env.mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledTimes(2);
		expect(
			artifacts.linkIndex.incoming
				.get(resolvedEdgeKey("folder-a/target.md"))
				?.get("folder-a/source.md"),
		).toBe(1);
		expect(
			artifacts.linkIndex.incoming
				.get(resolvedEdgeKey("folder-b/target.md"))
				?.get("folder-b/source.md"),
		).toBe(1);
	});

	test("checks for yielding every 128 references within one source", async () => {
		const env = new VaultEnvironmentBuilder([
			{
				path: "source.md",
				links: Array.from({ length: 256 }, (_, index) => `missing-${index}`),
			},
		]).build();
		let yieldCount = 0;

		await buildLinkIndexArtifactsChunked(env.mockVault, env.mockMetadataCache, {
			yieldIntervalMs: 0,
			yieldFn: async () => {
				yieldCount++;
			},
		});

		expect(yieldCount).toBe(2);
	});

	test("checks for yielding every 64 files", async () => {
		const env = new VaultEnvironmentBuilder(
			Array.from({ length: 64 }, (_, index) => ({
				path: `note-${index}.md`,
			})),
		).build();
		let yieldCount = 0;

		await buildLinkIndexArtifactsChunked(env.mockVault, env.mockMetadataCache, {
			yieldIntervalMs: 0,
			yieldFn: async () => {
				yieldCount++;
			},
		});

		expect(yieldCount).toBe(1);
	});
});
