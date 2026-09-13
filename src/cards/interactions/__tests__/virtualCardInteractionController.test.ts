import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import type { CardItem } from "cards/CardItem";
import { createVirtualCardInteractionController } from "../virtualCardInteractionController";
import type { VirtualCardInteractionController } from "../virtualCardInteractionController";
import type { ItemInteractionDescriptor } from "../interactionTypes";

interface TestBinding {
	readonly physicalCellSlot: number;
	readonly descriptor: ItemInteractionDescriptor | null;
}

function syncCards(
	controller: VirtualCardInteractionController,
	bindings: readonly {
		readonly slotId: number;
		readonly descriptor: ItemInteractionDescriptor | null;
	}[],
): boolean {
	const cells: TestBinding[] = bindings.map(({ slotId, descriptor }) => ({
		physicalCellSlot: slotId,
		descriptor,
	}));
	return controller.syncMountedRows([{ bindings: cells }], (cell) => cell.descriptor);
}

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
			syncCards(controller, [
				{ slotId: 0, descriptor },
				{ slotId: 1, descriptor: null },
			]),
		).toBe(true);
		const hydratedHandle = controller.getInteractionHandle(0);
		const emptyHandle = controller.getInteractionHandle(1);

		controller.clear();
		controller.clear();
		expect(syncCards(controller, [])).toBe(false);
		syncCards(controller, [
			{ slotId: 0, descriptor },
			{ slotId: 1, descriptor },
		]);

		for (const [slotId, oldHandle] of [
			[0, hydratedHandle],
			[1, emptyHandle],
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
		const handle = controller.getInteractionHandle(0);

		expect(controller.resolveInteractionDescriptor(handle)).toBeNull();
		expect(syncCards(controller, [{ slotId: 0, descriptor }])).toBe(false);

		expect(controller.getInteractionHandle(0)).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBe(descriptor);
	});

	it("rotates the handle when a physical slot is rebound to another semantic item", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card-first", "notes/first-card.md");
		const second = createDescriptor("token-card-second", "notes/second-card.md");

		syncCards(controller, [{ slotId: 0, descriptor: first }]);
		const firstHandle = controller.getInteractionHandle(0);
		expect(syncCards(controller, [{ slotId: 0, descriptor: second }])).toBe(true);
		const secondHandle = controller.getInteractionHandle(0);

		expect(secondHandle).not.toBe(firstHandle);
		expect(controller.resolveInteractionDescriptor(firstHandle)).toBeNull();
		expect(controller.resolveInteractionDescriptor(secondHandle)).toBe(second);
	});

	it("retains the handle when refreshed data represents the same semantic item", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card", "notes/first-version.md");
		const refreshed = createDescriptor("token-card", "notes/refreshed-version.md");

		syncCards(controller, [{ slotId: 0, descriptor: first }]);
		const handle = controller.getInteractionHandle(0);
		expect(syncCards(controller, [{ slotId: 0, descriptor: refreshed }])).toBe(
			false,
		);

		expect(controller.getInteractionHandle(0)).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBe(refreshed);
	});

	it("drops a handle when its slot leaves the mounted window", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("token-card", "notes/card.md");
		syncCards(controller, [{ slotId: 0, descriptor }]);
		const handle = controller.getInteractionHandle(0);

		expect(syncCards(controller, [])).toBe(true);

		expect(controller.resolveInteractionDescriptor(handle)).toBeNull();
	});

	it("gives slots with the same semantic interaction independent handles", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card-shared", "notes/first-card.md");
		const second = createDescriptor("token-card-shared", "notes/second-card.md");

		syncCards(controller, [
			{ slotId: 0, descriptor: first },
			{ slotId: 1, descriptor: second },
		]);
		const firstHandle = controller.getInteractionHandle(0);
		const secondHandle = controller.getInteractionHandle(1);

		expect(firstHandle).not.toBe(secondHandle);
		expect(controller.resolveInteractionDescriptor(firstHandle)).toBe(first);
		expect(controller.resolveInteractionDescriptor(secondHandle)).toBe(second);

		syncCards(controller, [{ slotId: 1, descriptor: second }]);
		expect(controller.resolveInteractionDescriptor(firstHandle)).toBeNull();
		expect(controller.resolveInteractionDescriptor(secondHandle)).toBe(second);
	});

	it("keeps the handle for a mounted slot while its descriptor is unavailable", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("token-card", "notes/card.md");
		syncCards(controller, [{ slotId: 0, descriptor }]);
		const handle = controller.getInteractionHandle(0);

		expect(syncCards(controller, [{ slotId: 0, descriptor: null }])).toBe(false);

		expect(controller.getInteractionHandle(0)).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBeNull();

		syncCards(controller, [{ slotId: 0, descriptor }]);
		expect(controller.getInteractionHandle(0)).toBe(handle);
		expect(controller.resolveInteractionDescriptor(handle)).toBe(descriptor);
	});
});
