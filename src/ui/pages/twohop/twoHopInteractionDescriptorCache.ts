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
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { TwoHopMountedCell } from "./twoHopMountedTypes";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
type TwoHopMountedHeaderCell = MountedFlatHeaderCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

function isMountedHeaderCell(cell: TwoHopMountedCell): cell is TwoHopMountedHeaderCell {
	return cell.cell.kind === "header";
}

function isMountedItemCell(cell: TwoHopMountedCell): cell is TwoHopMountedItemCell {
	return cell.cell.kind === "item";
}

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

export interface TwoHopInteractionDescriptorCacheParams {
	getMountedCellByInteractionId: (
		interactionId: string,
	) => TwoHopMountedCell | undefined;
	resolveDescriptor: (
		item: TwoHopVirtualListItem,
	) => ItemInteractionDescriptor | null;
	getDescriptorRevision?: () => unknown;
}

/**
 * Lazy descriptor cache owned by one mounted surface.
 *
 * Entries are keyed by interaction id and invalidated by item/header,
 * render-body, resolver, or descriptor revision changes. No descriptor is
 * created during mount or scroll. Unmounted entries are pruned on the next
 * interaction resolution, and explicit invalidation clears every entry;
 * counters are reported under `twoHop.interactionDescriptorCache.*`.
 */
export interface TwoHopInteractionDescriptorCache extends InteractionDescriptorResolverProvider {
	invalidate(): void;
}

/**
 * Creates a lazy provider that resolves against the current mounted rows.
 * The provider avoids per-scroll resolver snapshots; descriptor work happens
 * only when an interaction asks for a concrete descriptor.
 */
export function createTwoHopInteractionDescriptorCache({
	getMountedCellByInteractionId,
	resolveDescriptor,
	getDescriptorRevision,
}: TwoHopInteractionDescriptorCacheParams): TwoHopInteractionDescriptorCache {
	const descriptorsByInteractionId = new Map<string, ProviderCacheEntry>();

	return {
		resolveInteractionDescriptor: (interactionId) => {
			const mountedCell = getMountedCellByInteractionId(interactionId);
			pruneUnmountedEntries({
				descriptorsByInteractionId,
				getMountedCellByInteractionId,
				resolvedInteractionId: interactionId,
				resolvedMountedCell: mountedCell,
			});
			if (!mountedCell) {
				return null;
			}
			if (isMountedHeaderCell(mountedCell)) {
				return resolveMountedSectionHeaderDescriptor({
					headerCell: mountedCell,
					interactionId,
					descriptorsByInteractionId,
				});
			}
			if (!isMountedItemCell(mountedCell)) {
				descriptorsByInteractionId.delete(interactionId);
				return null;
			}

			const itemCell = mountedCell;
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
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("twoHop.interactionDescriptorCache.hit");
				}
				return cached.descriptor;
			}

			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.interactionDescriptorCache.miss");
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
		invalidate(): void {
			descriptorsByInteractionId.clear();
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.interactionDescriptorCache.invalidate");
			}
		},
	};
}

function pruneUnmountedEntries(params: {
	descriptorsByInteractionId: Map<string, ProviderCacheEntry>;
	getMountedCellByInteractionId: (
		interactionId: string,
	) => TwoHopMountedCell | undefined;
	resolvedInteractionId: string;
	resolvedMountedCell: TwoHopMountedCell | undefined;
}): void {
	for (const cachedInteractionId of params.descriptorsByInteractionId.keys()) {
		if (cachedInteractionId === params.resolvedInteractionId) {
			if (!params.resolvedMountedCell) {
				params.descriptorsByInteractionId.delete(cachedInteractionId);
			}
			continue;
		}
		if (params.getMountedCellByInteractionId(cachedInteractionId)) continue;

		params.descriptorsByInteractionId.delete(cachedInteractionId);
	}
}

function resolveMountedSectionHeaderDescriptor(params: {
	headerCell: TwoHopMountedHeaderCell;
	interactionId: string;
	descriptorsByInteractionId: Map<string, ProviderCacheEntry>;
}): InteractionDescriptor | null {
	const headerCell = params.headerCell;
	const descriptor = headerCell.headerProps.interactionDescriptor;
	if (!descriptor) {
		params.descriptorsByInteractionId.delete(params.interactionId);
		return null;
	}

	const cached = params.descriptorsByInteractionId.get(params.interactionId);
	if (
		cached &&
		cached.kind === "sectionHeader" &&
		cached.headerPropsRevision === headerCell.headerProps &&
		cached.renderBodySectionId === headerCell.renderBodySectionId &&
		cached.renderBodyCellKey === headerCell.renderBodyCellKey &&
		Object.is(cached.renderBodyRevision, headerCell.renderBodyRevision)
	) {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.interactionDescriptorCache.hit");
		}
		return cached.descriptor;
	}

	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("twoHop.interactionDescriptorCache.miss");
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
