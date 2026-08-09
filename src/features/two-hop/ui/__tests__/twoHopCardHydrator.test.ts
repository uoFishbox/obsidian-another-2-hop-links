import { describe, expect, it, vi } from "vitest";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "ui/virtualization/scheduling/frameCoordinator";
import { DEFAULT_VIEW_PLAN_LAYOUT } from "ui/virtualization/svelte/viewPlanLayout";
import { createTwoHopCardHydrator } from "features/two-hop/ui/twoHopCardHydrator";
import { compileTwoHopProgressivePlan } from "features/two-hop/ui/twoHopProgressivePlan";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { compileFixedGridLayout } from "features/two-hop/ui/viewport/twoHopGeometry";

interface TestFrameCoordinator {
	readonly coordinator: VirtualFrameCoordinator;
	drain(): void;
}

function createTestFrameCoordinator(): TestFrameCoordinator {
	const tasks = new Map<string, () => void>();
	const taskKey = (lane: VirtualFrameLane, key: string): string => `${lane}:${key}`;
	const coordinator: VirtualFrameCoordinator = {
		schedule: (lane, key, task) => {
			const keyWithLane = taskKey(lane, key);
			if (tasks.has(keyWithLane)) return false;
			tasks.set(keyWithLane, task);
			return true;
		},
		cancel: (lane, key) => {
			tasks.delete(taskKey(lane, key));
		},
		isScheduled: (lane, key) => tasks.has(taskKey(lane, key)),
		dispose: () => tasks.clear(),
	};

	return {
		coordinator,
		drain() {
			while (tasks.size > 0) {
				const next = tasks.entries().next().value as
					| [string, () => void]
					| undefined;
				if (!next) return;
				tasks.delete(next[0]);
				next[1]();
			}
		},
	};
}

function createItem(index: number): TwoHopItemModel {
	return {
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `interaction:${index}`,
		interactionKey: `interaction:${index}`,
		searchKey: `item:${index}`,
		key: `item:${index}`,
	} as TwoHopItemModel;
}

describe("createTwoHopCardHydrator", () => {
	it("bounds retained models and keeps interactions only for foreground cards", () => {
		const items = Array.from({ length: 70 }, (_, index) => createItem(index));
		const section = createTwoHopSectionModel({
			id: "section",
			key: "section",
			kind: "new-links-section",
			title: "Section",
			items,
		});
		const layout = { ...DEFAULT_VIEW_PLAN_LAYOUT, columns: 1 };
		const geometry = compileFixedGridLayout([section], layout);
		const plan = compileTwoHopProgressivePlan(
			[section],
			geometry,
			geometry.rowCount,
		);
		const frames = createTestFrameCoordinator();
		const previewChanged = vi.fn();
		const resolver = vi.fn((item: TwoHopItemModel): CardRenderModel => {
			const interactionId = item.interactionId ?? item.key;
			const interactionDescriptor: ItemInteractionDescriptor = {
				interactionId,
				interactionKey: item.interactionKey,
				kind: "item",
				item: item.item,
				targetFile: null,
			};
			return {
				item: item.item,
				targetFile: null,
				title: item.key,
				ariaLabel: item.key,
				className: null,
				extension: null,
				directory: null,
				interactionId,
				interactionKey: item.interactionKey ?? item.key,
				interactionDescriptor,
				presentation: undefined,
				searchQuery: "",
				previewRequest: null,
			};
		});
		const hydrator = createTwoHopCardHydrator({
			frameCoordinator: frames.coordinator,
			getPlan: () => plan,
			getRevision: () => 0,
			getResolver: () => resolver,
			isPreviewActive: () => true,
			onPreviewModelsChanged: previewChanged,
		});
		const firstKey = "item:section:item:0";
		const secondKey = "item:section:item:1";
		const firstConsumer = vi.fn();
		hydrator.registerConsumer(firstKey, firstConsumer);

		hydrator.setDemand({
			foreground: { start: 1, end: 2 },
			background: { start: 1, end: 3 },
			scrollActive: false,
		});
		frames.drain();

		expect(hydrator.getModel(firstKey)).toBeDefined();
		expect(hydrator.getModel(secondKey)).toBeDefined();
		expect(
			hydrator.interactionDescriptorResolverProvider.resolveInteractionDescriptor(
				"interaction:0",
			),
		).not.toBeNull();
		expect(
			hydrator.interactionDescriptorResolverProvider.resolveInteractionDescriptor(
				"interaction:1",
			),
		).toBeNull();

		hydrator.setDemand({
			foreground: { start: 2, end: 3 },
			background: { start: 2, end: 4 },
			scrollActive: false,
		});
		frames.drain();

		expect(hydrator.getModel(firstKey)).toBeDefined();
		expect(hydrator.getModel(secondKey)).toBeDefined();
		expect(
			hydrator.interactionDescriptorResolverProvider.resolveInteractionDescriptor(
				"interaction:0",
			),
		).toBeNull();
		expect(
			hydrator.interactionDescriptorResolverProvider.resolveInteractionDescriptor(
				"interaction:1",
			),
		).not.toBeNull();

		const resolverCallsBeforeReturn = resolver.mock.calls.length;
		hydrator.setDemand({
			foreground: { start: 1, end: 2 },
			background: { start: 1, end: 2 },
			scrollActive: false,
		});
		frames.drain();

		expect(hydrator.getModel(firstKey)).toBeDefined();
		expect(resolver.mock.calls.length).toBe(resolverCallsBeforeReturn);

		for (let rowIndex = 3; rowIndex < geometry.rowCount; rowIndex += 1) {
			hydrator.setDemand({
				foreground: { start: rowIndex, end: rowIndex + 1 },
				background: { start: rowIndex, end: rowIndex + 1 },
				scrollActive: false,
			});
			frames.drain();
		}

		expect(hydrator.getModel(firstKey)).toBeUndefined();
		expect(firstConsumer).toHaveBeenLastCalledWith(undefined);
	});
});
