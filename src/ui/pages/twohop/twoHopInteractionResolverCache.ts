import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
import type { MountedFlatItemCell } from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/reconciliation/viewPlanRenderRows";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "./twohopPageVirtualModel";

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection
>;

interface ProviderCacheEntry {
	itemRevision: TwoHopPageVirtualItem;
	renderBodyRevision: unknown;
	resolveDescriptorRevision: unknown;
	descriptor: ItemInteractionDescriptor;
}

export interface TwoHopInteractionResolverProviderParams {
	getMountedRows: () => readonly MountedFlatRowSlice<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>[];
	resolveDescriptor: (
		item: TwoHopPageVirtualItem,
	) => ItemInteractionDescriptor | null;
}

/**
 * Creates a lazy provider that resolves against the current mounted rows.
 * The provider avoids per-scroll resolver snapshots; descriptor work happens
 * only when an interaction asks for a concrete descriptor.
 */
export function createTwoHopInteractionResolverProvider({
	getMountedRows,
	resolveDescriptor,
}: TwoHopInteractionResolverProviderParams): InteractionDescriptorResolverProvider {
	const descriptorsByInteractionId = new Map<string, ProviderCacheEntry>();

	return {
		resolveInteractionDescriptor: (interactionId) => {
			const itemCell = findMountedItemCellByInteractionId({
				mountedRows: getMountedRows(),
				interactionId,
			});
			if (!itemCell) {
				descriptorsByInteractionId.delete(interactionId);
				return null;
			}

			const item = itemCell.cell.item;
			const cached = descriptorsByInteractionId.get(interactionId);
			if (
				cached &&
				cached.itemRevision === item &&
				Object.is(cached.renderBodyRevision, itemCell.renderBodyKey) &&
				Object.is(cached.resolveDescriptorRevision, resolveDescriptor)
			) {
				return cached.descriptor;
			}

			const descriptor = resolveDescriptor(item);
			if (!descriptor) {
				descriptorsByInteractionId.delete(interactionId);
				return null;
			}
			descriptorsByInteractionId.set(interactionId, {
				itemRevision: item,
				renderBodyRevision: itemCell.renderBodyKey,
				resolveDescriptorRevision: resolveDescriptor,
				descriptor,
			});
			return descriptor;
		},
	};
}

function findMountedItemCellByInteractionId(params: {
	mountedRows: readonly MountedFlatRowSlice<
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection
	>[];
	interactionId: string;
}): TwoHopMountedItemCell | null {
	for (const row of params.mountedRows) {
		for (const cell of row.cells) {
			if (cell.cell.kind !== "item") continue;

			const itemCell = cell as TwoHopMountedItemCell;
			const item = itemCell.cell.item;
			const itemInteractionId =
				item.interactionId ?? createItemInteractionKey(item.item);
			if (itemInteractionId === params.interactionId) {
				return itemCell;
			}
		}
	}

	return null;
}
