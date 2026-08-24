import { describe, expect, test } from "vitest";
import { TwoHopBranchBuilder } from "../TwoHopBranchBuilder";
import { collectLinkReferences } from "core/indexing/metadata/metadataExtractor";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";

function createOriginDefinitions(linkCount: number) {
	return [
		{
			path: "origin.md",
			links: Array.from({ length: linkCount }, (_, index) => `note${index}`),
		},
		...Array.from({ length: linkCount }, (_, index) => ({
			path: `note${index}.md`,
			links: [],
		})),
	];
}

describe("TwoHopBranchBuilder", () => {
	test("progressive build completes and returns correct branches even with large input", async () => {
		const { service, files } = new VaultEnvironmentBuilder(
			createOriginDefinitions(128),
		).build();

		await service.rebuildIndexesTimeSliced();

		const builder = new TwoHopBranchBuilder(service["metadataCache"], service);

		const branches = await builder.buildHop1OnlyBranches(
			files["origin.md"],
			collectLinkReferences(
				service["metadataCache"].getFileCache(files["origin.md"]),
			),
		);

		expect(branches).toHaveLength(128);
	});

	test("stops while walking outgoing links when the resolve is aborted", async () => {
		const { service, files } = new VaultEnvironmentBuilder(
			createOriginDefinitions(2),
		).build();
		await service.rebuildIndexesTimeSliced();
		const builder = new TwoHopBranchBuilder(service["metadataCache"], service);
		let checkpointCount = 0;
		const signal = {
			get aborted() {
				checkpointCount += 1;
				return checkpointCount === 2;
			},
		} as unknown as AbortSignal;

		await expect(
			builder.buildHop1OnlyBranches(
				files["origin.md"],
				collectLinkReferences(
					service["metadataCache"].getFileCache(files["origin.md"]),
				),
				signal,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(checkpointCount).toBe(2);
	});
});
