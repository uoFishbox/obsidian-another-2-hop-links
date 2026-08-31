import { describe, expect, test } from "vitest";
import { VaultEnvironmentBuilder } from "testing/helpers/VaultEnvironmentBuilder";
import {
	createEmptyLinkIndex,
	readCurrentSourceRow,
	reconcileSourceRow,
	resolvedEdgeKey,
	unresolvedEdgeKey,
} from "../link-index/linkIndex";

describe("two-map link index", () => {
	test("resolved and unresolved identities occupy separate namespaces", () => {
		expect(resolvedEdgeKey("Foo.md")).not.toBe(unresolvedEdgeKey("Foo.md"));
		expect(unresolvedEdgeKey("Foo")).toBe(unresolvedEdgeKey("FOO.md"));
	});

	test("reads a sorted row from the host graph and canonicalizes unresolved keys", () => {
		const { mockMetadataCache } = new VaultEnvironmentBuilder([
			{ path: "source.md", links: ["Target", "Foo", "foo.md"] },
			{ path: "Target.md" },
		]).build();

		expect(readCurrentSourceRow(mockMetadataCache, "source.md")).toEqual([
			{ key: resolvedEdgeKey("Target.md"), count: 1 },
			{ key: unresolvedEdgeKey("foo.md"), count: 2 },
		]);
	});

	test("linear row reconciliation keeps both directions consistent", () => {
		const index = createEmptyLinkIndex();
		const changed = new Set<string>();
		const sink = { markChangedEdge: (key: string) => changed.add(key) };

		reconcileSourceRow(
			index,
			"source.md",
			[
				{ key: resolvedEdgeKey("A.md"), count: 1 },
				{ key: resolvedEdgeKey("C.md"), count: 2 },
			],
			sink,
		);
		changed.clear();
		const didChange = reconcileSourceRow(
			index,
			"source.md",
			[
				{ key: resolvedEdgeKey("B.md"), count: 1 },
				{ key: resolvedEdgeKey("C.md"), count: 3 },
			],
			sink,
		);

		expect(didChange).toBe(true);
		expect(index.incoming.has(resolvedEdgeKey("A.md"))).toBe(false);
		expect(index.incoming.get(resolvedEdgeKey("B.md"))?.get("source.md")).toBe(1);
		expect(index.incoming.get(resolvedEdgeKey("C.md"))?.get("source.md")).toBe(3);
		expect(changed).toEqual(
			new Set([
				resolvedEdgeKey("A.md"),
				resolvedEdgeKey("B.md"),
				resolvedEdgeKey("C.md"),
			]),
		);
	});
});
