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

	it("registers and unregisters direct descriptors", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor("item:first", "[[first]]");

		registry.register(descriptor);
		expect(registry.resolve(descriptor.interactionId)).toBe(descriptor);

		registry.unregister(descriptor.interactionId);
		expect(registry.resolve(descriptor.interactionId)).toBeUndefined();
	});

	it("prefers direct descriptors over provider descriptors", () => {
		const registry = createInteractionRegistry();
		const provided = createDescriptor("item:first", "[[provided]]");
		const direct = createDescriptor("item:first", "[[direct]]");
		registry.syncInteractionDescriptorResolverProvider("mounted-items", {
			resolveInteractionDescriptor: () => provided,
		});

		registry.register(direct);
		expect(registry.resolve(direct.interactionId)).toBe(direct);

		registry.unregister(direct.interactionId);
		expect(registry.resolve(provided.interactionId)).toBe(provided);
	});

	it("resolves provider descriptors lazily without caching them", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor("item:first", "[[stale]]");
		const fresh = createDescriptor("item:first", "[[fresh]]");
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
		const descriptor = createDescriptor("item:first", "[[first]]");
		registry.syncInteractionDescriptorResolverProvider("mounted-items", {
			resolveInteractionDescriptor: () => descriptor,
		});

		registry.syncInteractionDescriptorResolverProvider("mounted-items", undefined);

		expect(registry.resolve(descriptor.interactionId)).toBeUndefined();
	});
});
