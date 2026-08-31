import { describe, expect, test } from "vitest";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import { IndexQueryEngine } from "../index-service/IndexQueryEngine";
import { buildIndexSnapshotAsync } from "./snapshotTestHelpers";
import { resolvedEdgeKey } from "../link-index/linkIndex";

function createEnvironment(
	definitions: Array<{ path: string; links?: string[]; tags?: string[] }>,
) {
	const env = new VaultEnvironmentBuilder(definitions).build();
	return {
		...env,
		engine: new IndexQueryEngine(env.mockVault, env.mockMetadataCache),
	};
}

describe("IndexQueryEngine", () => {
	test("resolved queries take priority over unresolved identity", async () => {
		const env = createEnvironment([
			{ path: "resolved-source.md", links: ["Note"] },
			{ path: "unresolved-source.md", links: ["note.md"] },
			{ path: "Note.md" },
		]);
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);

		const backlinks = env.engine.getBacklinksForLink(snapshot, "Note.md");

		expect(backlinks.map((link) => link.sourceFile.path)).toEqual([
			"resolved-source.md",
		]);
	});

	test("unresolved queries canonicalize case variants and aggregate counts per source", async () => {
		const env = createEnvironment([
			{ path: "A.md", links: ["Foo", "foo.md"] },
			{ path: "B.md", links: ["FOO"] },
		]);
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);

		const backlinks = env.engine.getBacklinksForLink(snapshot, "foo.md");

		expect(backlinks.map((link) => link.sourceFile.path)).toEqual(["A.md", "B.md"]);
		expect(backlinks[0].backlinkCount).toBe(2);
		expect(env.engine.getBacklinkCountForLink(snapshot, "Foo.md")).toBe(2);
	});

	test("rawText and position are materialized lazily and cached immutably", async () => {
		const env = createEnvironment([
			{ path: "source.md", links: ["target#Heading"] },
			{ path: "target.md" },
		]);
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);

		const first = env.engine.getBacklinksForLink(snapshot, "target.md");
		const second = env.engine.getBacklinksForLink(snapshot, "target.md");

		expect(first[0]).toMatchObject({
			rawText: "target#Heading",
			isUnresolved: false,
			backlinkCount: 1,
		});
		expect(first[0].position).toBeDefined();
		expect(Object.isFrozen(first)).toBe(true);
		expect(second).toBe(first);
	});

	test("edge-key invalidation refreshes presentation metadata", async () => {
		const env = createEnvironment([
			{ path: "source.md", links: ["target"] },
			{ path: "target.md" },
		]);
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);
		expect(env.engine.getBacklinksForLink(snapshot, "target.md")[0].rawText).toBe(
			"target",
		);
		env.builder.addFile({ path: "source.md", links: ["target#New"] });
		env.engine.invalidate([resolvedEdgeKey("target.md")]);

		expect(env.engine.getBacklinksForLink(snapshot, "target.md")[0].rawText).toBe(
			"target#New",
		);
	});

	test("threshold and unresolved-single queries use unique sources", async () => {
		const env = createEnvironment([
			{ path: "A.md", links: ["missing", "missing"] },
			{ path: "B.md", links: ["target"] },
			{ path: "target.md" },
		]);
		const snapshot = await buildIndexSnapshotAsync(
			env.mockVault,
			env.mockMetadataCache,
		);

		expect(env.engine.isUnresolvedWithSingleBacklink(snapshot, "Missing.md")).toBe(
			true,
		);
		expect(
			env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 1),
		).toBe(true);
		expect(
			env.engine.hasAtLeastUniqueBacklinkSources(snapshot, "target.md", 2),
		).toBe(false);
	});
});
