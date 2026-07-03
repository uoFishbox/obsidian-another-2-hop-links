import type {
	InteractionDescriptor,
	ItemInteractionDescriptor,
	SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
import type {
	MountedFlatHeaderCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import { resolveTwoHopItemInteractionKey } from "./twoHopVirtualListModel";

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedHeaderCell = MountedFlatHeaderCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

interface ItemProviderCacheEntry {
	kind: "item";
	itemRevision: TwoHopVirtualListItem;
	renderBodySectionId: string;
	renderBodySourceKey: string | undefined;
	renderBodyRevision: unknown;
	resolveDescriptorRevision: unknown;
	descriptorRevision: unknown;
	descriptor: ItemInteractionDescriptor;
}

interface SectionHeaderProviderCacheEntry {
	kind: "sectionHeader";
	headerPropsRevision: unknown;
	renderBodySectionId: string;
	renderBodyCellKey: string | undefined;
	renderBodyRevision: unknown;
	descriptor: SectionHeaderInteractionDescriptor;
}

type ProviderCacheEntry = ItemProviderCacheEntry | SectionHeaderProviderCacheEntry;

export interface TwoHopInteractionResolverProviderParams {
	getMountedRows: () => readonly MountedFlatRowSlice<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[];
	resolveDescriptor: (
		item: TwoHopVirtualListItem,
	) => ItemInteractionDescriptor | null;
	getDescriptorRevision?: () => unknown;
}

/**
 * Creates a lazy provider that resolves against the current mounted rows.
 * The provider avoids per-scroll resolver snapshots; descriptor work happens
 * only when an interaction asks for a concrete descriptor.
 */
export function createTwoHopInteractionResolverProvider({
	getMountedRows,
	resolveDescriptor,
	getDescriptorRevision,
}: TwoHopInteractionResolverProviderParams): InteractionDescriptorResolverProvider {
	const descriptorsByInteractionId = new Map<string, ProviderCacheEntry>();

	return {
		resolveInteractionDescriptor: (interactionId) => {
			const mountedRows = getMountedRows();
			const headerDescriptor = resolveMountedSectionHeaderDescriptor({
				mountedRows,
				interactionId,
				descriptorsByInteractionId,
			});
			if (headerDescriptor) {
				return headerDescriptor;
			}

			const itemCell = findMountedItemCellByInteractionId({
				mountedRows,
				interactionId,
			});
			if (!itemCell) {
				descriptorsByInteractionId.delete(interactionId);
				return null;
			}

			const item = itemCell.cell.item;
			const cached = descriptorsByInteractionId.get(interactionId);
			const descriptorRevision = getDescriptorRevision?.();
			if (
				cached &&
				cached.kind === "item" &&
				cached.itemRevision === item &&
				cached.renderBodySectionId === itemCell.renderBodySectionId &&
				cached.renderBodySourceKey === itemCell.renderBodySourceKey &&
				Object.is(cached.renderBodyRevision, itemCell.renderBodyRevision) &&
				Object.is(cached.resolveDescriptorRevision, resolveDescriptor) &&
				Object.is(cached.descriptorRevision, descriptorRevision)
			) {
				return cached.descriptor;
			}

			const descriptor = resolveDescriptor(item);
			if (!descriptor) {
				descriptorsByInteractionId.delete(interactionId);
				return null;
			}
			descriptorsByInteractionId.set(interactionId, {
				kind: "item",
				itemRevision: item,
				renderBodySectionId: itemCell.renderBodySectionId,
				renderBodySourceKey: itemCell.renderBodySourceKey,
				renderBodyRevision: itemCell.renderBodyRevision,
				resolveDescriptorRevision: resolveDescriptor,
				descriptorRevision,
				descriptor,
			});
			return descriptor;
		},
	};
}

function resolveMountedSectionHeaderDescriptor(params: {
	mountedRows: readonly MountedFlatRowSlice<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[];
	interactionId: string;
	descriptorsByInteractionId: Map<string, ProviderCacheEntry>;
}): InteractionDescriptor | null {
	const headerCell = findMountedHeaderCellByInteractionId({
		mountedRows: params.mountedRows,
		interactionId: params.interactionId,
	});
	if (!headerCell) return null;

	const descriptor = headerCell.headerProps.interactionDescriptor;
	if (!descriptor) return null;

	const cached = params.descriptorsByInteractionId.get(params.interactionId);
	if (
		cached &&
		cached.kind === "sectionHeader" &&
		cached.headerPropsRevision === headerCell.headerProps &&
		cached.renderBodySectionId === headerCell.renderBodySectionId &&
		cached.renderBodyCellKey === headerCell.renderBodyCellKey &&
		Object.is(cached.renderBodyRevision, headerCell.renderBodyRevision)
	) {
		return cached.descriptor;
	}

	params.descriptorsByInteractionId.set(params.interactionId, {
		kind: "sectionHeader",
		headerPropsRevision: headerCell.headerProps,
		renderBodySectionId: headerCell.renderBodySectionId,
		renderBodyCellKey: headerCell.renderBodyCellKey,
		renderBodyRevision: headerCell.renderBodyRevision,
		descriptor,
	});
	return descriptor;
}

function findMountedHeaderCellByInteractionId(params: {
	mountedRows: readonly MountedFlatRowSlice<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[];
	interactionId: string;
}): TwoHopMountedHeaderCell | null {
	for (const row of params.mountedRows) {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "header") continue;

			const headerCell = cell as TwoHopMountedHeaderCell;
			const headerInteractionId =
				headerCell.headerProps.interactionId ?? headerCell.sectionId;
			if (headerInteractionId === params.interactionId) {
				return headerCell;
			}
		}
	}

	return null;
}

function findMountedItemCellByInteractionId(params: {
	mountedRows: readonly MountedFlatRowSlice<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[];
	interactionId: string;
}): TwoHopMountedItemCell | null {
	for (const row of params.mountedRows) {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "item") continue;

			const itemCell = cell as TwoHopMountedItemCell;
			const item = itemCell.cell.item;
			const itemInteractionId =
				item.interactionId ?? resolveTwoHopItemInteractionKey(item);
			if (itemInteractionId === params.interactionId) {
				return itemCell;
			}
		}
	}

	return null;
}
