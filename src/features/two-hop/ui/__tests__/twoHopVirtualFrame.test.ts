import type { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	createTwoHopDocument,
	type TwoHopDocument,
} from "features/two-hop/ui/twoHopDocument";
import { buildTwoHopMountedRows } from "features/two-hop/ui/twoHopMountedRows";
import {
	compileTwoHopVirtualFrame,
	createEmptyTwoHopVirtualFrame,
	createTwoHopFrameInteractionProvider,
	diffTwoHopVirtualFrames,
	type CommittedTwoHopVirtualFrame,
	type TwoHopCommittedCellBinding,
} from "features/two-hop/ui/twoHopVirtualFrame";
import {
	createLayoutPublication,
	createSectionDataRevision,
} from "features/two-hop/ui/twoHopRevisions";
import { createTwoHopVirtualRowModel } from "features/two-hop/ui/twoHopVirtualRowModel";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";

const layout: ViewPlanLayoutMetrics = {
	containerWidth: 420,
	columns: 2,
	cellWidth: 200,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

function createSection(params: {
	readonly count: number;
	readonly revision: number;
	readonly suffix?: string;
}): TwoHopVirtualSectionDescriptor {
	const suffix = params.suffix ?? "";
	const items = Array.from({ length: params.count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}${suffix}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	return {
		sourceRevision: createSectionDataRevision(params.revision),
		section: {
			kind: "new-links-section",
			rawSectionId: "section",
			sectionId: "section",
			sectionKey: "section",
			title: "Section",
		},
		sectionKey: "section",
		sectionId: "section",
		title: "Section",
		totalCount: params.count,
		loadedCount: params.count,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
}

function createDocument(params: {
	readonly section: TwoHopVirtualSectionDescriptor;
	readonly visibleCount: number;
	readonly previousDocument?: TwoHopDocument;
}): TwoHopDocument {
	return createTwoHopDocument({
		sections: [params.section],
		visibleCounts: { section: params.visibleCount },
		initialVisibleCount: params.visibleCount,
		previousDocument: params.previousDocument,
	});
}

function createCardModel(
	item: TwoHopVirtualListItem,
	title: string,
	withInteraction = false,
): CardRenderModel {
	const targetFile = {
		path: `${item.virtualKey}.md`,
		basename: item.virtualKey,
		extension: "md",
		parent: null,
		stat: { mtime: 1 },
	} as TFile;
	return {
		item: item.item,
		targetFile,
		title,
		ariaLabel: title,
		className: null,
		extension: "md",
		directory: null,
		interactionId: item.interactionId ?? item.virtualKey,
		interactionKey: item.interactionId ?? item.virtualKey,
		interactionDescriptor: withInteraction
			? {
					interactionId: item.interactionId ?? item.virtualKey,
					interactionKey: item.interactionId ?? item.virtualKey,
					kind: "item",
					item: item.item,
					targetFile,
				}
			: null,
		presentation: undefined,
		searchQuery: "",
		searchScope: "title-and-content",
		contentPreview: undefined,
		previewRefreshToken: 0,
		previewActivationIdentity: `preview:${title}`,
		previewOverride: null,
		previewSnapshot: {
			identity: `preview:${title}`,
			file: targetFile,
			searchQuery: "",
			previewRefreshToken: 0,
			previewOverride: null,
		},
	};
}

function findItem(
	frame: CommittedTwoHopVirtualFrame,
	virtualKey: string,
): TwoHopCommittedCellBinding {
	const binding = [...frame.cellsBySlot.values()].find(
		(candidate) =>
			candidate.mountedCell.cell.kind === "item" &&
			candidate.mountedCell.cell.item.virtualKey === virtualKey,
	);
	if (!binding) throw new Error(`Missing frame item: ${virtualKey}`);
	return binding;
}

describe("compileTwoHopVirtualFrame", () => {
	it("publishes one binding object as the shared row and slot truth", () => {
		const section = createSection({ count: 3, revision: 1 });
		const document = createDocument({ section, visibleCount: 3 });
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const mountedBuild = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: rowModel.rowCount },
		});
		const previous = createEmptyTwoHopVirtualFrame(layout);
		const frame = compileTwoHopVirtualFrame({
			previous,
			mountedBuild,
			layout,
			previewWindow: {
				previewRange: { start: 0, end: rowModel.rowCount },
				active: true,
			},
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const diff = diffTwoHopVirtualFrames(previous, frame);

		for (const row of frame.rowSlots) {
			for (const binding of row.cells) {
				expect(frame.cellsBySlot.get(binding.slot)).toBe(binding);
			}
		}
		expect(diff.ownerStarted).toHaveLength(mountedBuild.cells.length);
		expect(diff.ownerEnded).toHaveLength(0);
	});

	it("replaces only the rebound physical row during a one-row range shift", () => {
		const section = createSection({ count: 20, revision: 1 });
		const document = createDocument({ section, visibleCount: 20 });
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const allocator = createResidentRowSlotAllocator();
		const firstBuild = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 4 },
			rowSlotAllocator: allocator,
		});
		const first = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild: firstBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 4 }, active: true },
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const secondBuild = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 5 },
			previousBuild: firstBuild,
			rowSlotAllocator: allocator,
		});
		const second = compileTwoHopVirtualFrame({
			previous: first,
			mountedBuild: secondBuild,
			layout,
			previewWindow: { previewRange: { start: 1, end: 5 }, active: true },
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const firstRowsBySlot = new Map(
			first.rowSlots.map((row) => [row.slotIndex, row] as const),
		);
		const changedRows = second.rowSlots.filter(
			(row) => firstRowsBySlot.get(row.slotIndex) !== row,
		);

		expect(second.rowSlots).not.toBe(first.rowSlots);
		expect(changedRows).toHaveLength(1);
		for (const row of second.rowSlots) {
			if (changedRows.includes(row)) continue;
			const previousRow = firstRowsBySlot.get(row.slotIndex);
			expect(row).toBe(previousRow);
			expect(row.cells).toBe(previousRow?.cells);
			expect(row.cellSlots).toBe(previousRow?.cellSlots);
		}
	});

	it("issues a new owner and body when load-more becomes an item", () => {
		const section = createSection({ count: 5, revision: 1 });
		const firstDocument = createDocument({ section, visibleCount: 1 });
		const allocator = createResidentRowSlotAllocator();
		const firstRowModel = createTwoHopVirtualRowModel(
			firstDocument,
			createLayoutPublication(layout, 1),
		);
		const firstBuild = buildTwoHopMountedRows({
			rowModel: firstRowModel,
			rowRange: { start: 0, end: firstRowModel.rowCount },
			rowSlotAllocator: allocator,
		});
		const first = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild: firstBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: true },
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const loadMore = [...first.cellsBySlot.values()].find(
			(binding) => binding.mountedCell.cell.kind === "load-more",
		);
		expect(loadMore).toBeDefined();

		const nextDocument = createDocument({
			section,
			visibleCount: 3,
			previousDocument: firstDocument,
		});
		const nextRowModel = createTwoHopVirtualRowModel(
			nextDocument,
			createLayoutPublication(layout, 1),
		);
		const nextBuild = buildTwoHopMountedRows({
			rowModel: nextRowModel,
			rowRange: { start: 0, end: nextRowModel.rowCount },
			previousBuild: firstBuild,
			rowSlotAllocator: allocator,
		});
		const next = compileTwoHopVirtualFrame({
			previous: first,
			mountedBuild: nextBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 3 }, active: true },
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const replacement = [...next.cellsBySlot.values()].find(
			(binding) => binding.slot === loadMore?.slot,
		);

		expect(replacement?.mountedCell.cell.kind).toBe("item");
		expect(replacement?.owner).not.toBe(loadMore?.owner);
		expect(replacement?.body).not.toBe(loadMore?.body);
	});

	it("retains owner but recreates affected specs for a same-key publication", () => {
		const allocator = createResidentRowSlotAllocator();
		const initialSection = createSection({
			count: 2,
			revision: 1,
			suffix: ":initial",
		});
		const initialDocument = createDocument({
			section: initialSection,
			visibleCount: 2,
		});
		const initialRowModel = createTwoHopVirtualRowModel(
			initialDocument,
			createLayoutPublication(layout, 1),
		);
		const initialBuild = buildTwoHopMountedRows({
			rowModel: initialRowModel,
			rowRange: { start: 0, end: initialRowModel.rowCount },
			rowSlotAllocator: allocator,
		});
		const resolver = vi.fn((cell) =>
			cell.cell.kind === "item"
				? createCardModel(cell.cell.item, cell.cell.item.searchKey)
				: undefined,
		);
		const initial = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild: initialBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: true },
			bindingIdentity: resolver,
			resolveCardModel: resolver,
		});
		const initialItem = findItem(initial, "item:0");

		const updatedSection = createSection({
			count: 2,
			revision: 2,
			suffix: ":updated",
		});
		const updatedDocument = createDocument({
			section: updatedSection,
			visibleCount: 2,
			previousDocument: initialDocument,
		});
		const updatedRowModel = createTwoHopVirtualRowModel(
			updatedDocument,
			createLayoutPublication(layout, 1),
		);
		const updatedBuild = buildTwoHopMountedRows({
			rowModel: updatedRowModel,
			rowRange: { start: 0, end: updatedRowModel.rowCount },
			previousBuild: initialBuild,
			rowSlotAllocator: allocator,
		});
		const updated = compileTwoHopVirtualFrame({
			previous: initial,
			mountedBuild: updatedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: true },
			bindingIdentity: resolver,
			resolveCardModel: resolver,
		});
		const updatedItem = findItem(updated, "item:0");

		expect(updatedItem.owner).toBe(initialItem.owner);
		expect(updatedItem.cardModel?.title).toContain(":updated");
		expect(updatedItem.preview).not.toBe(initialItem.preview);
	});

	it("invalidates every continuous owner when column topology resets", () => {
		const section = createSection({ count: 8, revision: 1 });
		const document = createDocument({ section, visibleCount: 8 });
		const allocator = createResidentRowSlotAllocator();
		const initialRowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const initialBuild = buildTwoHopMountedRows({
			rowModel: initialRowModel,
			rowRange: { start: 0, end: initialRowModel.rowCount },
			rowSlotAllocator: allocator,
		});
		const initial = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild: initialBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 5 }, active: true },
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const singleColumnLayout = {
			...layout,
			columns: 1,
			cellWidth: 420,
		};
		const nextRowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(singleColumnLayout, 2),
		);
		const nextBuild = buildTwoHopMountedRows({
			rowModel: nextRowModel,
			rowRange: { start: 0, end: nextRowModel.rowCount },
			previousBuild: initialBuild,
			rowSlotAllocator: allocator,
		});
		const next = compileTwoHopVirtualFrame({
			previous: initial,
			mountedBuild: nextBuild,
			layout: singleColumnLayout,
			previewWindow: { previewRange: { start: 0, end: 9 }, active: true },
			bindingIdentity: undefined,
			resolveCardModel: () => undefined,
		});
		const diff = diffTwoHopVirtualFrames(initial, next);

		expect(diff.ownerEnded.length).toBeGreaterThan(0);
		expect(diff.ownerStarted.length).toBeGreaterThan(0);
		for (const nextBinding of next.cellsBySlot.values()) {
			const previousBinding = [...initial.cellsBySlot.values()].find(
				(candidate) =>
					candidate.slot.debugIndex === nextBinding.slot.debugIndex,
			);
			if (previousBinding) {
				expect(nextBinding.owner).not.toBe(previousBinding.owner);
			}
		}
	});

	it("re-resolves specs but not ownership when the card resolver changes", () => {
		const section = createSection({ count: 2, revision: 1 });
		const document = createDocument({ section, visibleCount: 2 });
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const mountedBuild = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: rowModel.rowCount },
		});
		const firstResolver = (cell: Parameters<typeof createCardModel>[0]) =>
			createCardModel(cell, "first");
		const first = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: true },
			bindingIdentity: firstResolver,
			resolveCardModel: (cell) =>
				cell.cell.kind === "item" ? firstResolver(cell.cell.item) : undefined,
		});
		const secondResolver = (cell: Parameters<typeof createCardModel>[0]) =>
			createCardModel(cell, "second");
		const second = compileTwoHopVirtualFrame({
			previous: first,
			mountedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: true },
			bindingIdentity: secondResolver,
			resolveCardModel: (cell) =>
				cell.cell.kind === "item" ? secondResolver(cell.cell.item) : undefined,
		});
		const firstItem = findItem(first, "item:0");
		const secondItem = findItem(second, "item:0");

		expect(secondItem.owner).toBe(firstItem.owner);
		expect(secondItem.cardModel?.title).toBe("second");
		expect(secondItem.preview).not.toBe(firstItem.preview);
	});

	it("changes only the frame window when preview activation changes", () => {
		const section = createSection({ count: 2, revision: 1 });
		const document = createDocument({ section, visibleCount: 2 });
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const mountedBuild = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: rowModel.rowCount },
		});
		const resolver = vi.fn(() => undefined);
		const first = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: false },
			bindingIdentity: resolver,
			resolveCardModel: resolver,
		});
		resolver.mockClear();
		const second = compileTwoHopVirtualFrame({
			previous: first,
			mountedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 2 }, active: true },
			bindingIdentity: resolver,
			resolveCardModel: resolver,
		});

		expect(second.previewWindow.active).toBe(true);
		expect(second).not.toBe(first);
		expect(second.layout).toBe(first.layout);
		expect(second.rowSlots).toBe(first.rowSlots);
		expect(second.cellsBySlot).toBe(first.cellsBySlot);
		expect(second.previewBindingsBySlot).toBe(first.previewBindingsBySlot);
		expect(second.interactionsById).toBe(first.interactionsById);
		expect(resolver).not.toHaveBeenCalled();
		for (const binding of second.cellsBySlot.values()) {
			expect(first.cellsBySlot.get(binding.slot)).toBe(binding);
		}
	});

	it("resolves interactions directly from the current frame", () => {
		const section = createSection({ count: 1, revision: 1 });
		const document = createDocument({ section, visibleCount: 1 });
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const mountedBuild = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: rowModel.rowCount },
		});
		let current = compileTwoHopVirtualFrame({
			previous: createEmptyTwoHopVirtualFrame(layout),
			mountedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
			bindingIdentity: "with-interaction",
			resolveCardModel: (cell) =>
				cell.cell.kind === "item"
					? createCardModel(cell.cell.item, "item", true)
					: undefined,
		});
		const provider = createTwoHopFrameInteractionProvider(() => current);

		expect(provider.resolveInteractionDescriptor("item:0")).toBe(
			current.interactionsById.get("item:0"),
		);
		current = compileTwoHopVirtualFrame({
			previous: current,
			mountedBuild,
			layout,
			previewWindow: { previewRange: { start: 0, end: 1 }, active: true },
			bindingIdentity: "without-interaction",
			resolveCardModel: (cell) =>
				cell.cell.kind === "item"
					? createCardModel(cell.cell.item, "item")
					: undefined,
		});
		expect(provider.resolveInteractionDescriptor("item:0")).toBeNull();
	});
});
