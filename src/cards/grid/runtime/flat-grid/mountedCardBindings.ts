import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import type { VirtualPreviewBinding } from "preview/scheduling/virtualPreviewSurface";
import type { MountedFlatGridCell, MountedFlatGridRow } from "./mountedCells";
import type { FlatGridLogicalCell } from "./logicalCell";
import type { ItemInteractionDescriptor } from "cards/interactions/interactionTypes";
import type { VirtualCardInteractionBinding } from "cards/interactions/virtualCardInteractionController";

export type CardGridMountedItemCell<T> = MountedFlatGridCell<T> & {
	readonly cell: Extract<FlatGridLogicalCell<T>, { kind: "item" }>;
};

/** Derived bindings committed with a mounted card-grid snapshot. */
export interface CardGridBindings {
	readonly previewBindings: VirtualPreviewBinding[];
	readonly interactionBindings: VirtualCardInteractionBinding[];
}

export interface BuildCardGridBindingsParams<T> {
	rows: readonly MountedFlatGridRow<T>[];
	resolvePreviewRequest?(item: T, index: number): CardPreviewRequest | null;
	resolveInteractionDescriptor?(
		item: T,
		index: number,
	): ItemInteractionDescriptor | null;
}

export function isCardGridMountedItemCell<T>(
	mountedCell: MountedFlatGridCell<T> | null | undefined,
): mountedCell is CardGridMountedItemCell<T> {
	return mountedCell?.cell.kind === "item";
}

/** Resolves immutable preview and interaction bindings from mounted card rows. */
export function buildCardGridBindings<T>({
	rows,
	resolvePreviewRequest,
	resolveInteractionDescriptor,
}: BuildCardGridBindingsParams<T>): CardGridBindings {
	const previewBindings: VirtualPreviewBinding[] = [];
	const interactionBindings: VirtualCardInteractionBinding[] = [];

	for (const row of rows) {
		for (const mountedCell of row.bindings) {
			if (!isCardGridMountedItemCell(mountedCell)) continue;
			const { item, itemIndex } = mountedCell.cell;
			const previewRequest = resolvePreviewRequest?.(item, itemIndex);
			if (previewRequest) {
				previewBindings.push({
					key: String(mountedCell.key),
					rowIndex: mountedCell.rowIndex,
					request: previewRequest,
				});
			}

			const descriptor = resolveInteractionDescriptor?.(item, itemIndex);
			if (descriptor) {
				interactionBindings.push({
					slotId: String(mountedCell.physicalCellSlot),
					descriptor,
				});
			}
		}
	}

	return {
		previewBindings,
		interactionBindings,
	};
}
