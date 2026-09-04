import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { CardItem } from "cards/CardItem";
import { createInteractionRegistry } from "../interactionRegistry";
import type { ItemInteractionDescriptor } from "../interactionTypes";

function createDescriptor(
	interactionId: string,
	dragRawText: string,
	filePath: string,
): ItemInteractionDescriptor {
	const file = { path: filePath } as TFile;
	return {
		interactionId,
		kind: "item",
		item: { type: "file", data: file } satisfies CardItem,
		targetFile: file,
		dragRawText,
	};
}

describe("interactionRegistry", () => {
	it("allocates stable short interaction tokens per semantic key", () => {
		const registry = createInteractionRegistry();

		expect(registry.createInteractionToken("item:file:first.md")).toBe("i0");
		expect(registry.createInteractionToken("item:file:first.md")).toBe("i0");
		expect(registry.createInteractionToken("item:file:second.md")).toBe("i1");
		expect(registry.createInteractionToken("section:first", "h")).toBe("h0");
	});

	it("releases a direct descriptor through its registration lease", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor(
			"token-registry-direct",
			"[[drag-alias]]",
			"notes/registry-target.md",
		);

		const release = registry.register(descriptor);
		expect(registry.resolve(descriptor.interactionId)).toBe(descriptor);

		release();
		expect(registry.resolve(descriptor.interactionId)).toBeUndefined();
	});

	it("keeps a newer owner when an earlier registration is released", () => {
		const registry = createInteractionRegistry();
		const first = createDescriptor("shared-token", "[[first]]", "notes/first.md");
		const second = createDescriptor(
			"shared-token",
			"[[second]]",
			"notes/second.md",
		);
		const releaseFirst = registry.register(first);
		const releaseSecond = registry.register(second);

		releaseFirst();

		expect(registry.resolve("shared-token")).toBe(second);
		releaseSecond();
		expect(registry.resolve("shared-token")).toBeUndefined();
	});

	it("restores the previous owner when the latest registration is released", () => {
		const registry = createInteractionRegistry();
		const first = createDescriptor("shared-token", "[[first]]", "notes/first.md");
		const second = createDescriptor(
			"shared-token",
			"[[second]]",
			"notes/second.md",
		);
		const releaseFirst = registry.register(first);
		const releaseSecond = registry.register(second);

		releaseSecond();

		expect(registry.resolve("shared-token")).toBe(first);
		releaseFirst();
	});

	it("makes registration leases idempotent across registry clears", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor("shared-token", "[[stale]]", "notes/stale.md");
		const fresh = createDescriptor("shared-token", "[[fresh]]", "notes/fresh.md");
		const releaseStale = registry.register(stale);

		registry.clear();
		const releaseFresh = registry.register(fresh);
		releaseStale();
		releaseStale();

		expect(registry.resolve("shared-token")).toBe(fresh);
		releaseFresh();
	});

	it("prefers direct descriptors over provider descriptors", () => {
		const registry = createInteractionRegistry();
		const provided = createDescriptor(
			"token-provider-item",
			"[[provided-alias]]",
			"notes/provider-target.md",
		);
		const direct = createDescriptor(
			"token-provider-item",
			"[[direct-alias]]",
			"notes/direct-target.md",
		);
		registry.syncInteractionDescriptorResolverProvider("mounted-items", {
			resolveInteractionDescriptor: () => provided,
		});

		const release = registry.register(direct);
		expect(registry.resolve(direct.interactionId)).toBe(direct);

		release();
		expect(registry.resolve(provided.interactionId)).toBe(provided);
	});

	it("resolves provider descriptors lazily without caching them", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor(
			"token-lazy-item",
			"[[stale-alias]]",
			"notes/stale-target.md",
		);
		const fresh = createDescriptor(
			"token-lazy-item",
			"[[fresh-alias]]",
			"notes/fresh-target.md",
		);
		let descriptor = stale;
		const resolveInteractionDescriptor = vi.fn(() => descriptor);

		registry.syncInteractionDescriptorResolverProvider("mounted-items", {
			resolveInteractionDescriptor,
		});
		expect(resolveInteractionDescriptor).not.toHaveBeenCalled();
		expect(registry.resolve(stale.interactionId)).toBe(stale);

		descriptor = fresh;
		expect(registry.resolve(fresh.interactionId)).toBe(fresh);
		expect(resolveInteractionDescriptor).toHaveBeenCalledTimes(2);
	});

	it("removes a provider when its scope is cleared", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor(
			"token-cleared-item",
			"[[cleared-alias]]",
			"notes/cleared-target.md",
		);
		registry.syncInteractionDescriptorResolverProvider("mounted-items", {
			resolveInteractionDescriptor: () => descriptor,
		});

		registry.syncInteractionDescriptorResolverProvider("mounted-items", undefined);

		expect(registry.resolve(descriptor.interactionId)).toBeUndefined();
	});
});
