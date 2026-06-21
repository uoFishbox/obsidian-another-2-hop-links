import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import { createInteractionRegistry } from "../interactionRegistry";
import type { ItemInteractionDescriptor } from "../interactionTypes";

function createDescriptor(
	interactionId: string,
	dragRawText: string,
): ItemInteractionDescriptor {
	const file = { path: `${interactionId}.md` } as TFile;
	return {
		interactionId,
		kind: "item",
		item: { type: "file", data: file } satisfies ViewItem,
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

	it("replaces a scoped snapshot and removes descriptors that left the scope", () => {
		const registry = createInteractionRegistry();
		const first = createDescriptor("item:first", "[[first]]");
		const staleSecond = createDescriptor("item:second", "[[stale]]");
		const freshSecond = createDescriptor("item:second", "[[fresh]]");

		registry.syncInteractionDescriptors("mounted-items", [
			first,
			staleSecond,
		]);
		registry.syncInteractionDescriptors("mounted-items", [freshSecond]);

		expect(registry.resolve("item:first")).toBeUndefined();
		expect(registry.resolve("item:second")).toBe(freshSecond);
	});

	it("restores a scoped descriptor after a direct registration is removed", () => {
		const registry = createInteractionRegistry();
		const scoped = createDescriptor("item:first", "[[scoped]]");
		const direct = createDescriptor("item:first", "[[direct]]");

		registry.syncInteractionDescriptors("mounted-items", [scoped]);
		registry.register(direct);
		registry.unregister(direct.interactionId);

		expect(registry.resolve("item:first")).toBe(scoped);
	});

	it("resolves a scoped lazy descriptor only when requested", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor("item:first", "[[first]]");
		const resolve = vi.fn(() => descriptor);

		registry.syncInteractionDescriptorResolvers("mounted-items", [
			{ interactionId: descriptor.interactionId, resolve },
		]);

		expect(resolve).not.toHaveBeenCalled();
		expect(registry.resolve(descriptor.interactionId)).toBe(descriptor);
		expect(registry.resolve(descriptor.interactionId)).toBe(descriptor);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("invalidates cached lazy descriptors when a scoped resolver snapshot changes", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor("item:first", "[[stale]]");
		const fresh = createDescriptor("item:first", "[[fresh]]");

		registry.syncInteractionDescriptorResolvers("mounted-items", [
			{ interactionId: stale.interactionId, resolve: () => stale },
		]);
		expect(registry.resolve(stale.interactionId)).toBe(stale);

		registry.syncInteractionDescriptorResolvers("mounted-items", [
			{ interactionId: fresh.interactionId, resolve: () => fresh },
		]);

		expect(registry.resolve(fresh.interactionId)).toBe(fresh);
	});

	it("keeps cached lazy descriptors for unchanged resolvers", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor("item:first", "[[first]]");
		const resolve = vi.fn(() => descriptor);
		const resolver = { interactionId: descriptor.interactionId, resolve };

		registry.syncInteractionDescriptorResolvers("mounted-items", [
			resolver,
		]);
		expect(registry.resolve(descriptor.interactionId)).toBe(descriptor);

		registry.syncInteractionDescriptorResolvers("mounted-items", [
			resolver,
			{
				interactionId: "item:second",
				resolve: () => createDescriptor("item:second", "[[second]]"),
			},
		]);

		expect(registry.resolve(descriptor.interactionId)).toBe(descriptor);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("resolves provider descriptors lazily without caching them", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor("item:first", "[[stale]]");
		const fresh = createDescriptor("item:first", "[[fresh]]");
		let descriptor = stale;
		const resolveInteractionDescriptor = vi.fn(() => descriptor);

		registry.syncInteractionDescriptorResolverProvider(
			"mounted-items",
			{ resolveInteractionDescriptor },
		);

		expect(resolveInteractionDescriptor).not.toHaveBeenCalled();
		expect(registry.resolve(stale.interactionId)).toBe(stale);

		descriptor = fresh;

		expect(registry.resolve(fresh.interactionId)).toBe(fresh);
		expect(resolveInteractionDescriptor).toHaveBeenCalledTimes(2);
	});

	it("replaces scoped resolver snapshots when a provider is registered for the same scope", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor("item:first", "[[stale]]");
		const fresh = createDescriptor("item:first", "[[fresh]]");

		registry.syncInteractionDescriptorResolvers("mounted-items", [
			{ interactionId: stale.interactionId, resolve: () => stale },
		]);
		expect(registry.resolve(stale.interactionId)).toBe(stale);

		registry.syncInteractionDescriptorResolverProvider(
			"mounted-items",
			{ resolveInteractionDescriptor: () => fresh },
		);

		expect(registry.resolve(fresh.interactionId)).toBe(fresh);
	});
});
