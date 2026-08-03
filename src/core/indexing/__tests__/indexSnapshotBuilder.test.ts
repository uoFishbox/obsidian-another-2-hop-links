import { describe, expect, test } from "vitest";
import {
	buildIndexesAsync,
	buildIndexSnapshotAsync,
} from "../index-service/indexSnapshotBuilder";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { serializeSnapshot, serializeTagIndex } from "./snapshotTestHelpers";

function getDestinationPaths(
	summary: { destinations: ReadonlyMap<string, unknown> } | undefined,
): string[] | undefined {
	return summary ? Array.from(summary.destinations.keys()) : undefined;
}

describe("index snapshot builders", () => {
	test("buildIndexesAsync returns snapshot and tag index", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{
				path: "origin.md",
				links: ["target", "missing"],
				tags: ["#alpha"],
			},
			{ path: "peer.md", links: ["target"] },
			{ path: "target.md" },
			{ path: "asset.png", tags: ["#ignored"] },
		]).build();

		const syncResult = await buildIndexesAsync(mockVault, mockMetadataCache);
		const asyncResult = await buildIndexesAsync(mockVault, mockMetadataCache);

		expect(serializeSnapshot(asyncResult.snapshot)).toEqual(
			serializeSnapshot(syncResult.snapshot),
		);
		expect(serializeTagIndex(asyncResult.tagIndex)).toEqual(
			serializeTagIndex(syncResult.tagIndex),
		);
	});

	test("derived indexes are not duplicated even with duplicate links from same source to destination", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{ path: "origin.md", links: ["target", "target"] },
			{ path: "target.md" },
		]).build();

		const snapshot = await buildIndexSnapshotAsync(mockVault, mockMetadataCache);

		expect(snapshot.backlinksMap.get("target.md")?.get("origin.md")?.count).toBe(2);
		expect(getDestinationPaths(snapshot.sourceSummaries.get("origin.md"))).toEqual([
			"target.md",
		]);
		expect(
			new Set(
				snapshot.sourceSummaries
					.get("origin.md")
					?.firstRefIndexByLookupKey.keys(),
			),
		).toEqual(new Set(["target.md"]));
	});

	test("reverse index from unresolved links is consistent between sync and async builds", async () => {
		const { mockVault, mockMetadataCache } = new VaultEnvironmentBuilder([
			{ path: "origin.md", links: ["missing", "target"] },
			{ path: "peer.md", links: ["missing"] },
			{ path: "target.md" },
		]).build();

		const syncSnapshot = await buildIndexSnapshotAsync(
			mockVault,
			mockMetadataCache,
		);
		const asyncSnapshot = await buildIndexSnapshotAsync(
			mockVault,
			mockMetadataCache,
			{ yieldIntervalMs: 0 },
		);

		expect(
			syncSnapshot.sourceSummaries.get("origin.md")?.unresolvedLookupKeys,
		).toEqual(new Set(["missing.md"]));
		expect(syncSnapshot.unresolvedLinkLookupToSources.get("missing.md")).toEqual(
			new Set(["origin.md", "peer.md"]),
		);
		expect(serializeSnapshot(asyncSnapshot)).toEqual(
			serializeSnapshot(syncSnapshot),
		);
	});
});
