import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type {
	ItemInteractionDescriptor,
	SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import type {
	MountedFlatHeaderCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/reconciliation/viewPlanRenderRows";
import type { TwoHopIndexedLink } from "types/domain";
import { createTwoHopInteractionResolverProvider } from "../twoHopInteractionResolverCache";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedHeaderCell = MountedFlatHeaderCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedRow = MountedFlatRowSlice<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

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
}): readonly TwoHopMountedRow[] {
	const cell = {
		cellSlotKey: params.cellSlotKey ?? 0,
		renderSlotIndex: params.cellSlotKey ?? 0,
		renderBodyKey: params.renderBodyKey ?? params.item.virtualKey,
		cell: {
			kind: "item",
			item: params.item,
		},
	} as unknown as TwoHopMountedItemCell;

	return [
		{
			rowIndex: 0,
			rowKey: 0,
			key: 0,
			top: 0,
			cells: [cell],
		},
	];
}

function createMountedHeaderRows(params: {
	interactionId?: string;
	sectionId?: string;
	descriptor?: SectionHeaderInteractionDescriptor;
	renderBodyKey?: string;
}): readonly TwoHopMountedRow[] {
	const sectionId = params.sectionId ?? "branch-alpha";
	const headerCell = {
		cellSlotKey: 0,
		renderSlotIndex: 0,
		renderBodyKey: params.renderBodyKey ?? `header:${sectionId}`,
		sectionId,
		cell: {
			kind: "header",
		},
		headerProps: {
			interactionId: params.interactionId,
			interactionKind: "sectionHeader",
			interactionDescriptor: params.descriptor,
		},
	} as unknown as TwoHopMountedHeaderCell;

	return [
		{
			rowIndex: 0,
			rowKey: 0,
			key: 0,
			top: 0,
			cells: [headerCell],
		},
	];
}

function createDescriptor(item: TwoHopVirtualListItem): ItemInteractionDescriptor {
	return {
		interactionId: item.interactionId ?? "",
		kind: "item",
		item: item.item,
		targetFile: null,
	};
}

describe("twoHopInteractionResolverCache", () => {
	it("provider resolves against the current mounted rows", () => {
		let mountedRows: readonly TwoHopMountedRow[] = [];
		const firstItem = createItem("alpha.md");
		const secondItem = createItem("beta.md");
		const firstDescriptor = createDescriptor(firstItem);
		const secondDescriptor = createDescriptor(secondItem);
		const resolveDescriptor = vi.fn((item: TwoHopVirtualListItem) => {
			if (item === firstItem) return firstDescriptor;
			if (item === secondItem) return secondDescriptor;
			return null;
		});
		const provider = createTwoHopInteractionResolverProvider({
			getMountedRows: () => mountedRows,
			resolveDescriptor,
		});

		mountedRows = createMountedRows({ item: firstItem });

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			firstDescriptor,
		);

		mountedRows = createMountedRows({ item: secondItem });

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBeNull();
		expect(provider.resolveInteractionDescriptor("item:file:beta.md")).toBe(
			secondDescriptor,
		);
	});

	it("provider reuses descriptors while item and render body revisions are unchanged", () => {
		const item = createItem("alpha.md");
		const descriptor = createDescriptor(item);
		const resolveDescriptor = vi.fn(() => descriptor);
		const provider = createTwoHopInteractionResolverProvider({
			getMountedRows: () =>
				createMountedRows({
					item,
					renderBodyKey: "item:alpha:1",
				}),
			resolveDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			descriptor,
		);
		expect(provider.resolveInteractionDescriptor("item:file:alpha.md")).toBe(
			descriptor,
		);
		expect(resolveDescriptor).toHaveBeenCalledTimes(1);
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
		const provider = createTwoHopInteractionResolverProvider({
			getMountedRows: () =>
				createMountedRows({
					item,
					renderBodyKey: "item:alpha:1",
				}),
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
		const provider = createTwoHopInteractionResolverProvider({
			getMountedRows: () =>
				createMountedHeaderRows({
					interactionId: "h0",
					descriptor,
				}),
			resolveDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("h0")).toBe(descriptor);
		expect(resolveDescriptor).not.toHaveBeenCalled();
	});

	it("provider resolves section header ids against the current mounted rows", () => {
		let mountedRows: readonly TwoHopMountedRow[] = [];
		const firstDescriptor = createHeaderDescriptor("h0");
		const secondDescriptor = createHeaderDescriptor("h1");
		const provider = createTwoHopInteractionResolverProvider({
			getMountedRows: () => mountedRows,
			resolveDescriptor: vi.fn(() => null),
		});

		mountedRows = createMountedHeaderRows({
			interactionId: "h0",
			descriptor: firstDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("h0")).toBe(firstDescriptor);

		mountedRows = createMountedHeaderRows({
			interactionId: "h1",
			descriptor: secondDescriptor,
		});

		expect(provider.resolveInteractionDescriptor("h0")).toBeNull();
		expect(provider.resolveInteractionDescriptor("h1")).toBe(secondDescriptor);
	});
});
