import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import { createVirtualCardInteractionController } from "../virtualCardInteractionController";
import type { ItemInteractionDescriptor } from "../interactionTypes";

function createDescriptor(
	interactionId: string,
	path: string,
): ItemInteractionDescriptor {
	const file = { path, extension: "md" } as TFile;
	return {
		interactionId,
		interactionKey: interactionId,
		kind: "item",
		item: { type: "file", data: file } as ViewItem,
		targetFile: file,
	};
}

describe("virtualCardInteractionController", () => {
	it("updates the descriptor stored by a physical slot on rebind", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("item-a", "notes/a.md");
		const second = createDescriptor("item-b", "notes/b.md");

		controller.syncCards([{ slotId: "slot-0", descriptor: first }]);
		expect(controller.provider.resolveInteractionDescriptor("item-a")).toBe(first);

		controller.syncCards([{ slotId: "slot-0", descriptor: second }]);
		expect(controller.provider.resolveInteractionDescriptor("item-a")).toBeNull();
		expect(controller.provider.resolveInteractionDescriptor("item-b")).toBe(second);
	});

	it("drops entries for slots that leave the mounted window", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor("item-a", "notes/a.md");

		controller.syncCards([{ slotId: "slot-0", descriptor }]);
		controller.syncCards([]);

		expect(controller.provider.resolveInteractionDescriptor("item-a")).toBeNull();
	});

	it("updates and releases only slots included in a delta", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("item-a", "notes/a.md");
		const second = createDescriptor("item-b", "notes/b.md");
		const retained = createDescriptor("item-c", "notes/c.md");
		const permanentBinding = { slotId: "slot-0", descriptor: first };
		controller.syncCards([
			permanentBinding,
			{ slotId: "slot-1", descriptor: retained },
		]);

		permanentBinding.descriptor = second;
		controller.syncCardDelta({
			enteredSlots: [],
			reboundSlots: [permanentBinding],
			releasedSlots: [],
		});

		expect(controller.provider.resolveInteractionDescriptor("item-a")).toBeNull();
		expect(controller.provider.resolveInteractionDescriptor("item-b")).toBe(second);
		expect(controller.provider.resolveInteractionDescriptor("item-c")).toBe(
			retained,
		);

		controller.syncCardDelta({
			enteredSlots: [],
			reboundSlots: [],
			releasedSlots: [permanentBinding.slotId],
		});
		expect(controller.provider.resolveInteractionDescriptor("item-b")).toBeNull();
		expect(controller.provider.resolveInteractionDescriptor("item-c")).toBe(
			retained,
		);
	});
});
