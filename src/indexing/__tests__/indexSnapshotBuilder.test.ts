import { describe, expect, test } from "vitest";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { buildIndexesAsync } from "../index-service/indexSnapshotBuilder";
import { resolvedEdgeKey, unresolvedEdgeKey } from "../link-index/linkIndex";

describe("buildIndexesAsync", () => {
	test("builds the two-map link index and independent tag index", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target", "missing"], tags: ["#alpha"] },
			{ path: "target.md" },
		]).build();

		const result = await buildIndexesAsync(env.mockVault, env.mockMetadataCache);

		expect(result.snapshot.outgoing.get("source.md")).toEqual([
			{ key: resolvedEdgeKey("target.md"), count: 1 },
			{ key: unresolvedEdgeKey("missing"), count: 1 },
		]);
		expect(result.tagIndex.fileEntries.get("source.md")?.[0].tag).toBe("alpha");
	});
});
