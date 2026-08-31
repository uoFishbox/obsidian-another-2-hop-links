import { describe, expect, test } from "vitest";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { IncrementalIndexUpdater } from "../index-service/IncrementalIndexUpdater";
import { buildIndexSnapshotAsync, serializeSnapshot } from "./snapshotTestHelpers";
import { resolvedEdgeKey, unresolvedEdgeKey } from "../link-index/linkIndex";

describe("IncrementalIndexUpdater", () => {
	test("modify diffs only the changed source row", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["a"] },
			{ path: "a.md" },
			{ path: "b.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.addFile({ path: "source.md", links: ["b", "b"] });

		const result = await new IncrementalIndexUpdater(
			env.mockMetadataCache,
		).applyAsync(snapshot, [{ type: "modify", path: "source.md" }]);

		expect(snapshot.incoming.has(resolvedEdgeKey("a.md"))).toBe(false);
		expect(snapshot.incoming.get(resolvedEdgeKey("b.md"))?.get("source.md")).toBe(
			2,
		);
		expect(result.changedLinkSourcePaths).toEqual(new Set(["source.md"]));
	});

	test("create plus resolved source materializes an old unresolved link", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["missing"] },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.addFile({ path: "missing.md" });

		await new IncrementalIndexUpdater(env.mockMetadataCache).applyAsync(snapshot, [
			{ type: "create", path: "missing.md" },
			{ type: "resolve", path: "source.md" },
		]);

		expect(snapshot.incoming.has(unresolvedEdgeKey("missing"))).toBe(false);
		expect(
			snapshot.incoming.get(resolvedEdgeKey("missing.md"))?.has("source.md"),
		).toBe(true);
	});

	test("create reconciles only the created file and host-resolved sources", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "affected.md", links: ["first-missing"] },
			{ path: "unrelated.md", links: ["second-missing"] },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.addFile({ path: "first-missing.md" });
		env.builder.addFile({ path: "second-missing.md" });

		await new IncrementalIndexUpdater(env.mockMetadataCache).applyAsync(snapshot, [
			{ type: "create", path: "first-missing.md" },
			{ type: "resolve", path: "affected.md" },
		]);

		expect(
			snapshot.incoming
				.get(resolvedEdgeKey("first-missing.md"))
				?.has("affected.md"),
		).toBe(true);
		expect(
			snapshot.incoming
				.get(unresolvedEdgeKey("second-missing"))
				?.has("unrelated.md"),
		).toBe(true);
		expect(snapshot.incoming.has(resolvedEdgeKey("second-missing.md"))).toBe(false);
	});

	test("rename plus resolved sources matches a fresh host-graph build", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target"] },
			{ path: "target.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.removeFile("target.md");
		env.builder.addFile({ path: "archive/target.md" });

		await new IncrementalIndexUpdater(env.mockMetadataCache).applyAsync(snapshot, [
			{ type: "rename", oldPath: "target.md", newPath: "archive/target.md" },
			{ type: "resolve", path: "source.md" },
		]);
		const rebuilt = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);

		expect(serializeSnapshot(snapshot)).toEqual(serializeSnapshot(rebuilt));
	});

	test("rename re-evaluates prior incoming sources without resolve events", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target"] },
			{ path: "target.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.removeFile("target.md");
		env.builder.addFile({ path: "archive/target.md" });

		await new IncrementalIndexUpdater(env.mockMetadataCache).applyAsync(snapshot, [
			{ type: "rename", oldPath: "target.md", newPath: "archive/target.md" },
		]);
		const rebuilt = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);

		expect(serializeSnapshot(snapshot)).toEqual(serializeSnapshot(rebuilt));
	});

	test("delete re-evaluates prior incoming sources from the host graph", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target"] },
			{ path: "target.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.removeFile("target.md");

		await new IncrementalIndexUpdater(env.mockMetadataCache).applyAsync(snapshot, [
			{ type: "delete", path: "target.md" },
		]);

		expect(snapshot.incoming.has(resolvedEdgeKey("target.md"))).toBe(false);
		expect(
			snapshot.incoming.get(unresolvedEdgeKey("target"))?.has("source.md"),
		).toBe(true);
	});

	test("same structural row still invalidates lazy presentation data", async () => {
		const env = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["target"] },
			{ path: "target.md" },
		]).build();
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		env.builder.addFile({ path: "source.md", links: ["target#Heading"] });

		const result = await new IncrementalIndexUpdater(
			env.mockMetadataCache,
		).applyAsync(snapshot, [{ type: "modify", path: "source.md" }]);

		expect(result.cacheInvalidationKeys).toEqual(
			new Set([resolvedEdgeKey("target.md")]),
		);
		expect(result.changedLinkSourcePaths).toEqual(new Set(["source.md"]));
	});
});
