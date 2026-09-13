import {
	createInteractionHandle,
	type InteractionHandle,
	type ItemInteractionDescriptor,
} from "./interactionTypes";
import type { InteractionDescriptorResolverProvider } from "./interactionRegistry";

export interface VirtualCardInteractionController extends InteractionDescriptorResolverProvider {
	getInteractionHandle(physicalCellSlot: number): InteractionHandle;
	/** Synchronizes mounted cells without materializing an intermediate binding array. */
	syncMountedRows<TCell extends { readonly physicalCellSlot: number }>(
		rows: readonly {
			readonly bindings: readonly (TCell | null | undefined)[];
		}[],
		resolveDescriptor: (
			cell: TCell,
		) => ItemInteractionDescriptor | null | undefined,
	): boolean;
	clear(): void;
}

/** Owns one unique lookup handle for each live virtual card slot. */
export function createVirtualCardInteractionController(): VirtualCardInteractionController {
	const handleBySlot = new Map<number, InteractionHandle>();
	const descriptorByHandle = new Map<InteractionHandle, ItemInteractionDescriptor>();

	return {
		resolveInteractionDescriptor(interactionHandle) {
			return descriptorByHandle.get(interactionHandle) ?? null;
		},
		getInteractionHandle(physicalCellSlot) {
			const existing = handleBySlot.get(physicalCellSlot);
			if (existing) return existing;
			const handle = createInteractionHandle("v");
			handleBySlot.set(physicalCellSlot, handle);
			return handle;
		},
		syncMountedRows(rows, resolveDescriptor) {
			const activeSlots = new Set<number>();
			let handlesChanged = false;
			for (const row of rows) {
				for (const cell of row.bindings) {
					if (!cell) continue;
					const descriptor = resolveDescriptor(cell);
					if (descriptor === undefined) continue;
					const physicalCellSlot = cell.physicalCellSlot;
					activeSlots.add(physicalCellSlot);
					let handle = handleBySlot.get(physicalCellSlot);
					const previous = handle
						? descriptorByHandle.get(handle)
						: undefined;
					if (
						!handle ||
						(previous &&
							descriptor &&
							previous.interactionId !== descriptor.interactionId)
					) {
						if (handle) descriptorByHandle.delete(handle);
						handle = createInteractionHandle("v");
						handleBySlot.set(physicalCellSlot, handle);
						handlesChanged = true;
					}
					if (descriptor) descriptorByHandle.set(handle, descriptor);
					else descriptorByHandle.delete(handle);
				}
			}
			for (const physicalCellSlot of handleBySlot.keys()) {
				if (!activeSlots.has(physicalCellSlot)) {
					descriptorByHandle.delete(handleBySlot.get(physicalCellSlot)!);
					handleBySlot.delete(physicalCellSlot);
					handlesChanged = true;
				}
			}
			return handlesChanged;
		},
		clear() {
			handleBySlot.clear();
			descriptorByHandle.clear();
		},
	};
}
