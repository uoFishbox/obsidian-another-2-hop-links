import { describe, expect, test } from "vitest";
import { TwoHopBranchBuilder } from "../two-hop-resolver/TwoHopBranchBuilder";
import { collectLinkReferences } from "../metadata/metadataExtractor";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";

function createOriginDefinitions(linkCount: number) {
	return [
		{
			path: "origin.md",
			links: Array.from(
				{ length: linkCount },
				(_, index) => `note${index}`,
			),
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

		const builder = new TwoHopBranchBuilder(
			service["metadataCache"],
			service,
		);

		const branches = await builder.buildHop1OnlyBranches(
			files["origin.md"],
			collectLinkReferences(
				service["metadataCache"].getFileCache(files["origin.md"]),
			),
			{
				enableProgressiveTwoHopBuild: true,
				maxOutgoingToProcess: 0,
				maxHop2PerBranch: 0,
			},
		);

		expect(branches).toHaveLength(128);
	});
});
