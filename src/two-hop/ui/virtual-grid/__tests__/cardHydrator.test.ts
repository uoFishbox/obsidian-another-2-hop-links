import { describe, expect, it, vi } from "vitest";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type { ItemInteractionDescriptor } from "cards/interactions/interactionTypes";
import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "shared/ui/scheduling/frameCoordinator";
import { DEFAULT_TWO_HOP_GRID_LAYOUT } from "../rowModel";
import {
	createTwoHopCardHydrator,
	type TwoHopCardHydrationCell,
} from "../cardHydrator";
import { createTwoHopRowModel, type TwoHopRowModel } from "../rowModel";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";

interface TestFrameCoordinator {
	readonly coordinator: VirtualFrameCoordinator;
	isScheduled(lane: VirtualFrameLane): boolean;
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
		isScheduled: (lane) =>
			Array.from(tasks.keys()).some((key) => key.startsWith(`${lane}:`)),
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
		item: { type: "newLink" },
		interactionId: `interaction:${index}`,
		searchKey: `item:${index}`,
		key: `item:${index}`,
	} as TwoHopItemModel;
}

function resolveCardModel(item: TwoHopItemModel): CardRenderModel {
	const interactionId = item.interactionId ?? item.key;
	const interactionDescriptor: ItemInteractionDescriptor = {
		interactionId,
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
		interactionId,
		interactionDescriptor,
		searchQuery: "",
		previewRequest: null,
	};
}

function collectItemCells(
	rowModel: TwoHopRowModel,
	start: number,
	end: number,
): TwoHopCardHydrationCell[] {
	const cells: TwoHopCardHydrationCell[] = [];
	for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
		const row = rowModel.getRow(rowIndex);
		if (!row) continue;
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			const cell = row.getCell(columnIndex);
			if (cell?.kind === "item") cells.push(cell);
		}
	}
	return cells;
}

describe("createTwoHopCardHydrator", () => {
	it("does not scan cancelled scroll history when delayed idle work resumes", () => {
		const section = createTwoHopSectionModel({
			id: "section",
			kind: "new-links-section",
			title: "Section",
			items: [createItem(0)],
			totalCount: 1,
		});
		const frames = createTestFrameCoordinator();
		const resolver = vi.fn(resolveCardModel);
		const hydrator = createTwoHopCardHydrator({
			frameCoordinator: frames.coordinator,
			getRevision: () => 0,
			resolveCardModel: resolver,
			isPreviewActive: () => false,
			onPreviewModelsChanged: vi.fn(),
		});
		let expiredKeyReads = 0;
		for (let index = 0; index < 300; index += 1) {
			const cell: TwoHopCardHydrationCell = {
				kind: "item",
				section,
				rowIndex: index,
				columnIndex: 0,
				itemIndex: index,
				item: createItem(index),
				get logicalKey() {
					expiredKeyReads += 1;
					return `expired:${index}`;
				},
			};
			hydrator.setDemand({ foreground: [], background: [cell] });
		}
		hydrator.setDemand({ foreground: [], background: [] });
		expect(frames.isScheduled("idle")).toBe(false);
		const current: TwoHopCardHydrationCell = {
			kind: "item",
			section,
			rowIndex: 0,
			columnIndex: 0,
			itemIndex: 0,
			item: createItem(301),
			logicalKey: "current",
		};
		hydrator.setDemand({ foreground: [], background: [current] });
		expiredKeyReads = 0;
		frames.drain();
		expect(expiredKeyReads).toBe(0);
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(resolver).toHaveBeenCalledWith(current.item, 0);
		hydrator.dispose();
	});

	it("bounds retained models and keeps interactions only for foreground cards", () => {
		const items = Array.from({ length: 70 }, (_, index) => createItem(index));
		const section = createTwoHopSectionModel({
			id: "section",
			kind: "new-links-section",
			title: "Section",
			items,
			totalCount: items.length,
		});
		const layout = { ...DEFAULT_TWO_HOP_GRID_LAYOUT, columns: 1 };
		const rowModel = createTwoHopRowModel({
			sections: [section],
			layout,
		});
		const frames = createTestFrameCoordinator();
		const previewChanged = vi.fn();
		const resolver = vi.fn(resolveCardModel);
		const hydrator = createTwoHopCardHydrator({
			frameCoordinator: frames.coordinator,
			getRevision: () => 0,
			resolveCardModel: resolver,
			isPreviewActive: () => true,
			onPreviewModelsChanged: previewChanged,
		});
		const firstKey = "item:section:item:0";
		const secondKey = "item:section:item:1";
		const firstConsumer = vi.fn();
		hydrator.registerConsumer(firstKey, firstConsumer);

		hydrator.setDemand({
			foreground: collectItemCells(rowModel, 1, 2),
			background: collectItemCells(rowModel, 2, 3),
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
			foreground: collectItemCells(rowModel, 2, 3),
			background: collectItemCells(rowModel, 3, 4),
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
			foreground: collectItemCells(rowModel, 1, 2),
			background: [],
		});
		frames.drain();

		expect(hydrator.getModel(firstKey)).toBeDefined();
		expect(resolver.mock.calls.length).toBe(resolverCallsBeforeReturn);

		for (let rowIndex = 3; rowIndex < rowModel.rowCount; rowIndex += 1) {
			hydrator.setDemand({
				foreground: collectItemCells(rowModel, rowIndex, rowIndex + 1),
				background: [],
			});
			frames.drain();
		}

		expect(hydrator.getModel(firstKey)).toBeUndefined();
		expect(firstConsumer).toHaveBeenLastCalledWith(undefined);
	});

	it("replaces stale pending cells and refreshes resident cells on revision changes", () => {
		const firstItem = createItem(0);
		const replacementItem = createItem(0);
		const createModel = (item: TwoHopItemModel) =>
			createTwoHopRowModel({
				sections: [
					createTwoHopSectionModel({
						id: "section",
						kind: "new-links-section",
						title: "Section",
						items: [item],
						totalCount: 1,
					}),
				],
				layout: { ...DEFAULT_TWO_HOP_GRID_LAYOUT, columns: 1 },
			});
		const firstCell = collectItemCells(createModel(firstItem), 1, 2)[0]!;
		const replacementCell = collectItemCells(
			createModel(replacementItem),
			1,
			2,
		)[0]!;
		const frames = createTestFrameCoordinator();
		const resolver = vi.fn(resolveCardModel);
		let revision = 0;
		const hydrator = createTwoHopCardHydrator({
			frameCoordinator: frames.coordinator,
			getRevision: () => revision,
			resolveCardModel: resolver,
			isPreviewActive: () => false,
			onPreviewModelsChanged: vi.fn(),
		});

		hydrator.setDemand({ foreground: [firstCell], background: [] });
		hydrator.setDemand({ foreground: [replacementCell], background: [] });
		frames.drain();

		expect(resolver).toHaveBeenCalledTimes(1);
		expect(resolver.mock.calls[0]?.[0]).toBe(replacementItem);

		revision = 1;
		hydrator.refreshDemand();
		frames.drain();

		expect(resolver).toHaveBeenCalledTimes(2);
		expect(hydrator.getModel(replacementCell.logicalKey)).toBeDefined();
	});

	it("schedules background hydration on idle and promotes it to post-paint", () => {
		const item = createItem(0);
		const rowModel = createTwoHopRowModel({
			sections: [
				createTwoHopSectionModel({
					id: "section",
					kind: "new-links-section",
					title: "Section",
					items: [item],
					totalCount: 1,
				}),
			],
			layout: { ...DEFAULT_TWO_HOP_GRID_LAYOUT, columns: 1 },
		});
		const cell = collectItemCells(rowModel, 1, 2)[0]!;
		const frames = createTestFrameCoordinator();
		const hydrator = createTwoHopCardHydrator({
			frameCoordinator: frames.coordinator,
			getRevision: () => 0,
			resolveCardModel,
			isPreviewActive: () => false,
			onPreviewModelsChanged: vi.fn(),
		});

		hydrator.setDemand({ foreground: [], background: [cell] });
		expect(frames.isScheduled("idle")).toBe(true);

		hydrator.setDemand({ foreground: [cell], background: [] });
		expect(frames.isScheduled("idle")).toBe(false);
		expect(frames.isScheduled("post-paint")).toBe(true);
	});
});
