import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClickableHeaderHarness from "./ClickableHeaderHarness.svelte";
import { createInteractionRegistry } from "ui/interactions/interactionRegistry";
import type { SectionHeaderInteractionDescriptor } from "ui/interactions/interactionTypes";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		Platform: {
			isMobile: false,
		},
	};
});

function createDescriptor(interactionId: string): SectionHeaderInteractionDescriptor {
	return {
		interactionId,
		kind: "sectionHeader",
		link: {
			rawText: interactionId,
			path: undefined,
			isUnresolved: true,
			sourceFile: null,
		} as never,
		isOutgoingLink: true,
		targetFile: null,
	};
}

describe("ClickableHeader", () => {
	afterEach(() => {
		cleanup();
	});

	it("registers and unregisters its interaction descriptor through the registry context", async () => {
		const registry = createInteractionRegistry();
		const initialDescriptor = createDescriptor("section:alpha");
		const nextDescriptor = createDescriptor("section:beta");

		const view = render(ClickableHeaderHarness, {
			props: {
				registry,
				interactionId: initialDescriptor.interactionId,
				descriptor: initialDescriptor,
			},
		});

		expect(registry.resolve(initialDescriptor.interactionId)).toStrictEqual(
			initialDescriptor,
		);
		const header = view.container.querySelector(".cosense-card-links__box");
		expect(header).toHaveAttribute(
			"data-ccl-interaction-id",
			initialDescriptor.interactionId,
		);
		expect(header).not.toHaveAttribute("data-ccl-interaction-kind");
		expect(header).not.toHaveAttribute("data-directory");

		await view.rerender({
			registry,
			interactionId: nextDescriptor.interactionId,
			descriptor: nextDescriptor,
		});

		expect(registry.resolve(initialDescriptor.interactionId)).toBeUndefined();
		expect(registry.resolve(nextDescriptor.interactionId)).toStrictEqual(
			nextDescriptor,
		);

		view.unmount();

		expect(registry.resolve(nextDescriptor.interactionId)).toBeUndefined();
	});

	it("unregisters the previous descriptor without error when the prop transitions to undefined on rebind", async () => {
		const registry = createInteractionRegistry();
		const initialDescriptor = createDescriptor("section:gamma");

		const view = render(ClickableHeaderHarness, {
			props: {
				registry,
				interactionId: initialDescriptor.interactionId,
				descriptor: initialDescriptor,
			},
		});

		expect(registry.resolve(initialDescriptor.interactionId)).toStrictEqual(
			initialDescriptor,
		);

		await view.rerender({
			registry,
			interactionId: "section:gamma-tag",
			descriptor: undefined,
		});

		expect(registry.resolve(initialDescriptor.interactionId)).toBeUndefined();
	});
});
