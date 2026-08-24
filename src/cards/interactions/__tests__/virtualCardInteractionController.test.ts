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
	it("updates the descriptor stored by a physical slot on rebind", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card-first", "notes/first-card.md");
		const second = createDescriptor("token-card-second", "notes/second-card.md");

		controller.syncCards([{ slotId: "slot-0", descriptor: first }]);
		expect(
			controller.provider.resolveInteractionDescriptor(first.interactionId),
		).toBe(first);

		controller.syncCards([{ slotId: "slot-0", descriptor: second }]);
		expect(
			controller.provider.resolveInteractionDescriptor(first.interactionId),
		).toBeNull();
		expect(
			controller.provider.resolveInteractionDescriptor(second.interactionId),
		).toBe(second);
	});

	it("drops entries for slots that leave the mounted window", () => {
		const controller = createVirtualCardInteractionController();
		const descriptor = createDescriptor(
			"token-card-mounted",
			"notes/mounted-card.md",
		);

		controller.syncCards([{ slotId: "slot-0", descriptor }]);
		controller.syncCards([]);

		expect(
			controller.provider.resolveInteractionDescriptor(descriptor.interactionId),
		).toBeNull();
	});

	it("updates and releases cards through direct slot operations", () => {
		const controller = createVirtualCardInteractionController();
		const first = createDescriptor("token-card-first", "notes/first-card.md");
		const second = createDescriptor("token-card-second", "notes/second-card.md");
		const retained = createDescriptor(
			"token-card-retained",
			"notes/retained-card.md",
		);

		controller.setCard("slot-0", first);
		controller.setCard("slot-1", retained);
		controller.setCard("slot-0", second);

		expect(
			controller.provider.resolveInteractionDescriptor(first.interactionId),
		).toBeNull();
		expect(
			controller.provider.resolveInteractionDescriptor(second.interactionId),
		).toBe(second);
		expect(
			controller.provider.resolveInteractionDescriptor(retained.interactionId),
		).toBe(retained);

		controller.setCard("slot-0", null);
		expect(
			controller.provider.resolveInteractionDescriptor(second.interactionId),
		).toBeNull();
		expect(
			controller.provider.resolveInteractionDescriptor(retained.interactionId),
		).toBe(retained);
	});
});
