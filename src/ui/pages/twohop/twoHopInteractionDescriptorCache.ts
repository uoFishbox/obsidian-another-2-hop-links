import type {
	InteractionDescriptor,
	ItemInteractionDescriptor,
	SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
import type {
	TwoHopVirtualListItem,
} from "./twoHopVirtualListModel";
import type { TwoHopResidentCell } from "./twoHopCellBinding";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

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
	) => TwoHopResidentCell | undefined;
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
			const residentCell = getMountedCellByInteractionId(interactionId);
			pruneUnmountedEntries({
				descriptorsByInteractionId,
				getMountedCellByInteractionId,
				resolvedInteractionId: interactionId,
				resolvedMountedCell: residentCell,
			});
			if (!residentCell) {
				return null;
			}
			const compiledCell = residentCell.binding.compiledCell;
			if (compiledCell.logicalCell.kind === "header") {
				return resolveMountedSectionHeaderDescriptor({
					residentCell,
					interactionId,
					descriptorsByInteractionId,
				});
			}
			if (compiledCell.logicalCell.kind !== "item") {
				descriptorsByInteractionId.delete(interactionId);
				return null;
			}

			const item = compiledCell.logicalCell.item;
			const cached = descriptorsByInteractionId.get(interactionId);
			const descriptorRevision = getDescriptorRevision?.();
			if (
				cached &&
				cached.kind === "item" &&
				cached.itemRevision === item &&
				cached.renderBodySectionId === compiledCell.renderBodySectionId &&
				cached.renderBodySourceKey === compiledCell.renderBodySourceKey &&
				Object.is(cached.renderBodyRevision, compiledCell.renderBodyRevision) &&
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
				renderBodySectionId: compiledCell.renderBodySectionId,
				renderBodySourceKey: compiledCell.renderBodySourceKey,
				renderBodyRevision: compiledCell.renderBodyRevision,
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
	) => TwoHopResidentCell | undefined;
	resolvedInteractionId: string;
	resolvedMountedCell: TwoHopResidentCell | undefined;
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
	residentCell: TwoHopResidentCell;
	interactionId: string;
	descriptorsByInteractionId: Map<string, ProviderCacheEntry>;
}): InteractionDescriptor | null {
	const compiledCell = params.residentCell.binding.compiledCell;
	const headerProps = params.residentCell.rowFrame.sectionPlan.descriptor.headerProps;
	const descriptor = headerProps.interactionDescriptor;
	if (!descriptor) {
		params.descriptorsByInteractionId.delete(params.interactionId);
		return null;
	}

	const cached = params.descriptorsByInteractionId.get(params.interactionId);
	if (
		cached &&
		cached.kind === "sectionHeader" &&
		cached.headerPropsRevision === headerProps &&
		cached.renderBodySectionId === compiledCell.renderBodySectionId &&
		cached.renderBodyCellKey === compiledCell.renderBodyCellKey &&
		Object.is(cached.renderBodyRevision, compiledCell.renderBodyRevision)
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
		headerPropsRevision: headerProps,
		renderBodySectionId: compiledCell.renderBodySectionId,
		renderBodyCellKey: compiledCell.renderBodyCellKey,
		renderBodyRevision: compiledCell.renderBodyRevision,
		descriptor,
	});
	return descriptor;
}
