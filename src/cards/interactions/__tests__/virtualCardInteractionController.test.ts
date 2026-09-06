import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import type { CardItem } from "cards/CardItem";
import { createVirtualCardInteractionController } from "../virtualCardInteractionController";
import type { ItemInteractionDescriptor } from "../interactionTypes";

function createDescriptor(
	interactionId: string,
	path: string,
): ItemInteractionDescriptor {
	const file = { path, extension: "md" } as TFile;
	return {
		interactionId,
		kind: "item",
		item: { type: "file", data: file } as CardItem,
		targetFile: file,
	};
}

describe("virtualCardInteractionController", () => {
	it("invalidates hydrated and empty handles on clear and creates fresh bindings", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("card", "notes/card.md");
		expect(
			controller.syncCards([
				{ slotId: "hydrated", descriptor },
				{ slotId: "empty", descriptor: null },
			]),
		).toBe(true);
		const hydratedHandle = controller.getInteractionHandle("hydrated");
		const emptyHandle = controller.getInteractionHandle("empty");

		controller.clear();
		controller.clear();
		expect(controller.syncCards([])).toBe(false);
		controller.syncCards([
			{ slotId: "hydrated", descriptor },
			{ slotId: "empty", descriptor },
		]);

		for (const [slotId, oldHandle] of [
			["hydrated", hydratedHandle],
			["empty", emptyHandle],
		] as const) {
			expect(controller.resolveInteractionDescriptor(oldHandle)).toBeNull();
			const handle = controller.getInteractionHandle(slotId);
			expect(handle).not.toBe(oldHandle);
			expect(controller.resolveInteractionDescriptor(handle)).toBe(descriptor);
		}
	});

	it("allocates a stable handle before a slot descriptor is hydrated", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("token-card", "notes/card.md");
		const handle = controller.getInteractionHandle("slot-0");

		expect(controller.resolveInteractionDescriptor(handle)).toBeNull();
		expect(controller.syncCards([{ slotId: "slot-0", descriptor }])).toBe(false);

		expect(controller.getInteractionHandle("slot-0")).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBe(descriptor);
	});

	it("rotates the handle when a physical slot is rebound to another semantic item", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card-first", "notes/first-card.md");
		const second = createDescriptor("token-card-second", "notes/second-card.md");

		controller.syncCards([{ slotId: "slot-0", descriptor: first }]);
		const firstHandle = controller.getInteractionHandle("slot-0");
		expect(controller.syncCards([{ slotId: "slot-0", descriptor: second }])).toBe(
			true,
		);
		const secondHandle = controller.getInteractionHandle("slot-0");

		expect(secondHandle).not.toBe(firstHandle);
		expect(controller.resolveInteractionDescriptor(firstHandle)).toBeNull();
		expect(controller.resolveInteractionDescriptor(secondHandle)).toBe(second);
	});

	it("retains the handle when refreshed data represents the same semantic item", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card", "notes/first-version.md");
		const refreshed = createDescriptor("token-card", "notes/refreshed-version.md");

		controller.syncCards([{ slotId: "slot-0", descriptor: first }]);
		const handle = controller.getInteractionHandle("slot-0");
		expect(
			controller.syncCards([{ slotId: "slot-0", descriptor: refreshed }]),
		).toBe(false);

		expect(controller.getInteractionHandle("slot-0")).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBe(refreshed);
	});

	it("drops a handle when its slot leaves the mounted window", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("token-card", "notes/card.md");
		controller.syncCards([{ slotId: "slot-0", descriptor }]);
		const handle = controller.getInteractionHandle("slot-0");

		expect(controller.syncCards([])).toBe(true);

		expect(controller.resolveInteractionDescriptor(handle)).toBeNull();
	});

	it("gives slots with the same semantic interaction independent handles", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card-shared", "notes/first-card.md");
		const second = createDescriptor("token-card-shared", "notes/second-card.md");

		controller.syncCards([
			{ slotId: "slot-0", descriptor: first },
			{ slotId: "slot-1", descriptor: second },
		]);
		const firstHandle = controller.getInteractionHandle("slot-0");
		const secondHandle = controller.getInteractionHandle("slot-1");

		expect(firstHandle).not.toBe(secondHandle);
		expect(controller.resolveInteractionDescriptor(firstHandle)).toBe(first);
		expect(controller.resolveInteractionDescriptor(secondHandle)).toBe(second);

		controller.syncCards([{ slotId: "slot-1", descriptor: second }]);
		expect(controller.resolveInteractionDescriptor(firstHandle)).toBeNull();
		expect(controller.resolveInteractionDescriptor(secondHandle)).toBe(second);
	});

	it("keeps the handle for a mounted slot while its descriptor is unavailable", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("token-card", "notes/card.md");
		controller.syncCards([{ slotId: "slot-0", descriptor }]);
		const handle = controller.getInteractionHandle("slot-0");

		expect(controller.syncCards([{ slotId: "slot-0", descriptor: null }])).toBe(
			false,
		);

		expect(controller.getInteractionHandle("slot-0")).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBeNull();

		controller.syncCards([{ slotId: "slot-0", descriptor }]);
		expect(controller.getInteractionHandle("slot-0")).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBe(descriptor);
	});
});
