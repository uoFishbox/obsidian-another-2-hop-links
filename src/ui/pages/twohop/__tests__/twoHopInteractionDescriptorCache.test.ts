import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type {
	ItemInteractionDescriptor,
	SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import type { TwoHopIndexedLink } from "types/domain";
import { createTwoHopInteractionDescriptorCache } from "../twoHopInteractionDescriptorCache";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import type {
	TwoHopCellBinding,
	TwoHopResidentCell,
	TwoHopRowSlotFrame,
} from "../twoHopCellBinding";
import type { CompiledTwoHopCell, TwoHopSectionPlan } from "../twoHopViewPlan";

type TwoHopMountedRow = readonly TwoHopResidentCell[];

function createMountedCellResolver(
	rows: readonly TwoHopMountedRow[],
): (
	interactionId: string,
) => TwoHopResidentCell | undefined {
	const cellsByInteractionId = new Map<string, TwoHopResidentCell>();
	for (const row of rows) {
		for (const cell of row) {
			const interactionId = cell.binding.compiledCell.interactionId;
			if (interactionId) cellsByInteractionId.set(interactionId, cell);
		}
	}
	return (interactionId) => cellsByInteractionId.get(interactionId);
}

function createItem(path: string): TwoHopVirtualListItem {
	const file = { path, basename: path } as TFile;
	return {
		kind: "primary-link",
		item: { type: "file", data: file } satisfies ViewItem,
		interactionId: `item:file:${path}`,
		sourceSectionId: "primary",
		searchKey: path,
		virtualKey: path,
	};
}

function createHeaderDescriptor(
	interactionId: string,
): SectionHeaderInteractionDescriptor {
	return {
		interactionId,
		kind: "sectionHeader",
		link: {
			path: "branch.md",
			displayText: "branch",
		} as unknown as TwoHopIndexedLink,
		isOutgoingLink: true,
		targetFile: null,
	};
}

function createMountedRows(params: {
	item: TwoHopVirtualListItem;
	cellSlotKey?: number;
	renderBodyKey?: string;
	renderBodyRevision?: unknown;
}): readonly TwoHopMountedRow[] {
	const compiledCell = {
		logicalKey: params.item.virtualKey,
		renderBodyKey: params.renderBodyKey ?? params.item.virtualKey,
		renderBodyKind: "item",
		renderBodySectionId: "primary",
		renderBodySourceKey: params.item.virtualKey,
		renderBodyRevision: params.renderBodyRevision ?? null,
		logicalCell: {
			kind: "item",
			item: params.item,
		},
		cardModel: null,
		reuseFamily: "resolved-card",
		presentation: null,
		interactionId: params.item.interactionId ?? null,
	} as CompiledTwoHopCell;
	return [createResidentRow(compiledCell, {})];
}

function createMountedHeaderRows(params: {
	interactionId?: string;
	sectionId?: string;
	descriptor?: SectionHeaderInteractionDescriptor;
	renderBodyKey?: string;
	renderBodyRevision?: unknown;
}): readonly TwoHopMountedRow[] {
	const sectionId = params.sectionId ?? "branch-alpha";
	const headerProps = {
		interactionId: params.interactionId,
		interactionKind: "sectionHeader" as const,
		interactionDescriptor: params.descriptor,
	};
	const compiledCell = {
		logicalKey: `header:${sectionId}`,
		renderBodyKey: params.renderBodyKey ?? `header:${sectionId}`,
		renderBodyKind: "header",
		renderBodySectionId: sectionId,
		renderBodyCellKey: `header:${sectionId}`,
		renderBodyRevision: params.renderBodyRevision ?? null,
		logicalCell: {
			kind: "header",
			key: `header:${sectionId}`,
		},
		cardModel: null,
		reuseFamily: null,
		presentation: null,
		interactionId: params.interactionId ?? sectionId,
	} as CompiledTwoHopCell;
	return [createResidentRow(compiledCell, headerProps)];
}

function createResidentRow(
	compiledCell: CompiledTwoHopCell,
	headerProps: Record<string, unknown>,
): TwoHopMountedRow {
	const binding: TwoHopCellBinding = {
		epoch: 0,
		logicalRowIndex: 0,
		columnIndex: 0,
		compiledCell,
	};
	const sectionPlan = {
		sectionId: compiledCell.renderBodySectionId,
		descriptor: { headerProps },
	} as unknown as TwoHopSectionPlan;
	const rowFrame: TwoHopRowSlotFrame = {
		epoch: 0,
		slotIndex: 0,
		logicalRowIndex: 0,
		top: 0,
		sectionPlan,
		cells: [binding],
	};
	return [{ binding, rowFrame }];
}

function createDescriptor(item: TwoHopVirtualListItem): ItemInteractionDescriptor {
	return {
		interactionId: item.interactionId ?? "",
		kind: "item",
		item: item.item,
		targetFile: null,
	};
}

describe("twoHopInteractionDescriptorCache", () => {
	it("provider resolves against the current mounted rows", () => {
		let mountedRows: readonly TwoHopMountedRow[] = [];
		let getMountedCellByInteractionId = createMountedCellResolver(mountedRows);
		const firstItem = createItem("alpha.md");
		const secondItem = createItem("beta.md");
		const firstDescriptor = createDescriptor(firstItem);
		const secondDescriptor = createDescriptor(secondItem);
		const resolveDescriptor = vi.fn((item: TwoHopVirtualListItem) => {
			if (item === firstItem) return firstDescriptor;
			if (item === secondItem) return secondDescriptor;
			return null;
		});
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: (interactionId) =>
				getMountedCellByInteractionId(interactionId),
			resolveDescriptor,
		});

		mountedRows = createMountedRows({ item: firstItem });
		getMountedCellByInteractionId = createMountedCellResolver(mountedRows);

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			firstDescriptor,
		);

		mountedRows = createMountedRows({ item: secondItem });
		getMountedCellByInteractionId = createMountedCellResolver(mountedRows);

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBeNull();
		expect(provider.resolveInteractionDescriptor("item:file:beta.md")).toBe(
			secondDescriptor,
		);
	});

	it("prunes cached descriptors for items that are no longer mounted", () => {
		const firstItem = createItem("alpha.md");
		const secondItem = createItem("beta.md");
		let getMountedCellByInteractionId = createMountedCellResolver(
			createMountedRows({ item: firstItem }),
		);
		const resolveDescriptor = vi.fn(createDescriptor);
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: (interactionId) =>
				getMountedCellByInteractionId(interactionId),
			resolveDescriptor,
		});

		provider.resolveInteractionDescriptor("item:file:alpha.md");
		getMountedCellByInteractionId = createMountedCellResolver(
			createMountedRows({ item: secondItem }),
		);
		provider.resolveInteractionDescriptor("item:file:beta.md");
		getMountedCellByInteractionId = createMountedCellResolver(
			createMountedRows({ item: firstItem }),
		);
		provider.resolveInteractionDescriptor("item:file:alpha.md");

		expect(resolveDescriptor).toHaveBeenCalledTimes(3);
	});

	it("provider reuses descriptors while item and render body revisions are unchanged", () => {
		resetCCLDevMeasurements();
		const item = createItem("alpha.md");
		const descriptor = createDescriptor(item);
		const resolveDescriptor = vi.fn(() => descriptor);
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: createMountedCellResolver(
				createMountedRows({
					item,
					renderBodyKey: "item:alpha:1",
				}),
			),
			resolveDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			descriptor,
		);
		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			descriptor,
		);
		expect(resolveDescriptor).toHaveBeenCalledTimes(1);
		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.interactionDescriptorCache.miss"].count).toBe(1);
		expect(counters["twoHop.interactionDescriptorCache.hit"].count).toBe(1);

		provider.invalidate();
		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			descriptor,
		);
		expect(resolveDescriptor).toHaveBeenCalledTimes(2);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"twoHop.interactionDescriptorCache.invalidate"
			].count,
		).toBe(1);
	});

	it("provider reruns descriptor resolution when item render body revision changes", () => {
		const item = createItem("alpha.md");
		const firstDescriptor = createDescriptor(item);
		const secondDescriptor = createDescriptor(item);
		let renderBodyRevision: unknown = 1;
		let getMountedCellByInteractionId = createMountedCellResolver(
			createMountedRows({
				item,
				renderBodyKey: undefined,
				renderBodyRevision,
			}),
		);
		const resolveDescriptor = vi
			.fn()
			.mockReturnValueOnce(firstDescriptor)
			.mockReturnValueOnce(secondDescriptor);
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: (interactionId) =>
				getMountedCellByInteractionId(interactionId),
			resolveDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			firstDescriptor,
		);

		renderBodyRevision = 2;
		getMountedCellByInteractionId = createMountedCellResolver(
			createMountedRows({
				item,
				renderBodyKey: undefined,
				renderBodyRevision,
			}),
		);

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			secondDescriptor,
		);
		expect(resolveDescriptor).toHaveBeenCalledTimes(2);
	});

	it("provider reruns descriptor resolution when descriptor revision changes", () => {
		const item = createItem("alpha.md");
		const firstDescriptor = createDescriptor(item);
		const secondDescriptor = createDescriptor(item);
		let descriptorRevision: unknown = { searchQuery: "alpha" };
		const resolveDescriptor = vi
			.fn()
			.mockReturnValueOnce(firstDescriptor)
			.mockReturnValueOnce(secondDescriptor);
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: createMountedCellResolver(
				createMountedRows({
					item,
					renderBodyKey: "item:alpha:1",
				}),
			),
			resolveDescriptor,
			getDescriptorRevision: () => descriptorRevision,
		});

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			firstDescriptor,
		);

		descriptorRevision = { searchQuery: "beta" };

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			secondDescriptor,
		);
		expect(resolveDescriptor).toHaveBeenCalledTimes(2);
	});

	it("provider resolves mounted section header descriptors without item resolution", () => {
		const descriptor = createHeaderDescriptor("h0");
		const resolveDescriptor = vi.fn();
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: createMountedCellResolver(
				createMountedHeaderRows({
					interactionId: "h0",
					descriptor,
				}),
			),
			resolveDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("h0")).toBe(descriptor);
		expect(resolveDescriptor).not.toHaveBeenCalled();
	});

	it("provider resolves section header ids against the current mounted rows", () => {
		let mountedRows: readonly TwoHopMountedRow[] = [];
		let getMountedCellByInteractionId = createMountedCellResolver(mountedRows);
		const firstDescriptor = createHeaderDescriptor("h0");
		const secondDescriptor = createHeaderDescriptor("h1");
		const provider = createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: (interactionId) =>
				getMountedCellByInteractionId(interactionId),
			resolveDescriptor: vi.fn(() => null),
		});

		mountedRows = createMountedHeaderRows({
			interactionId: "h0",
			descriptor: firstDescriptor,
		});
		getMountedCellByInteractionId = createMountedCellResolver(mountedRows);

		expect(provider.resolveInteractionDescriptor("h0")).toBe(firstDescriptor);

		mountedRows = createMountedHeaderRows({
			interactionId: "h1",
			descriptor: secondDescriptor,
		});
		getMountedCellByInteractionId = createMountedCellResolver(mountedRows);

		expect(provider.resolveInteractionDescriptor("h0")).toBeNull();
		expect(provider.resolveInteractionDescriptor("h1")).toBe(secondDescriptor);
	});
});
