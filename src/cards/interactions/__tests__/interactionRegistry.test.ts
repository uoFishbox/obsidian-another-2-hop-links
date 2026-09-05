import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { CardItem } from "cards/CardItem";
import { createInteractionRegistry } from "../interactionRegistry";
import {
	createInteractionHandle,
	type ItemInteractionDescriptor,
} from "../interactionTypes";

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
	it("releases a direct descriptor through its registration lease", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor(
			"token-registry-direct",
			"[[drag-alias]]",
			"notes/registry-target.md",
		);
		const handle = createInteractionHandle();

		const release = registry.register(handle, descriptor);
		expect(registry.resolve(handle)).toBe(descriptor);

		release();
		expect(registry.resolve(handle)).toBeUndefined();
	});

	it("keeps a newer owner when an earlier registration is released", () => {
		const registry = createInteractionRegistry();
		const first = createDescriptor("shared-token", "[[first]]", "notes/first.md");
		const second = createDescriptor(
			"shared-token",
			"[[second]]",
			"notes/second.md",
		);
		const handle = createInteractionHandle();
		const releaseFirst = registry.register(handle, first);
		const releaseSecond = registry.register(handle, second);

		releaseFirst();

		expect(registry.resolve(handle)).toBe(second);
		releaseSecond();
		expect(registry.resolve(handle)).toBeUndefined();
	});

	it("restores the previous owner when the latest registration is released", () => {
		const registry = createInteractionRegistry();
		const first = createDescriptor("shared-token", "[[first]]", "notes/first.md");
		const second = createDescriptor(
			"shared-token",
			"[[second]]",
			"notes/second.md",
		);
		const handle = createInteractionHandle();
		const releaseFirst = registry.register(handle, first);
		const releaseSecond = registry.register(handle, second);

		releaseSecond();

		expect(registry.resolve(handle)).toBe(first);
		releaseFirst();
	});

	it("makes registration leases idempotent across registry clears", () => {
		const registry = createInteractionRegistry();
		const stale = createDescriptor("shared-token", "[[stale]]", "notes/stale.md");
		const fresh = createDescriptor("shared-token", "[[fresh]]", "notes/fresh.md");
		const handle = createInteractionHandle();
		const releaseStale = registry.register(handle, stale);

		registry.clear();
		const releaseFresh = registry.register(handle, fresh);
		releaseStale();
		releaseStale();

		expect(registry.resolve(handle)).toBe(fresh);
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
		const handle = createInteractionHandle();
		registry.setInteractionDescriptorResolverProvider({
			resolveInteractionDescriptor: () => provided,
		});

		const release = registry.register(handle, direct);
		expect(registry.resolve(handle)).toBe(direct);

		release();
		expect(registry.resolve(handle)).toBe(provided);
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
		const handle = createInteractionHandle();
		const resolveInteractionDescriptor = vi.fn(() => descriptor);

		registry.setInteractionDescriptorResolverProvider({
			resolveInteractionDescriptor,
		});
		expect(resolveInteractionDescriptor).not.toHaveBeenCalled();
		expect(registry.resolve(handle)).toBe(stale);

		descriptor = fresh;
		expect(registry.resolve(handle)).toBe(fresh);
		expect(resolveInteractionDescriptor).toHaveBeenCalledTimes(2);
	});

	it("removes a provider when its scope is cleared", () => {
		const registry = createInteractionRegistry();
		const descriptor = createDescriptor(
			"token-cleared-item",
			"[[cleared-alias]]",
			"notes/cleared-target.md",
		);
		const handle = createInteractionHandle();
		registry.setInteractionDescriptorResolverProvider({
			resolveInteractionDescriptor: () => descriptor,
		});

		registry.setInteractionDescriptorResolverProvider(undefined);

		expect(registry.resolve(handle)).toBeUndefined();
	});
});
