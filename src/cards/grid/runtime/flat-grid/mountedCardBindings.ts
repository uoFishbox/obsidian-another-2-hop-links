import type { CardPreviewRequest } from "card-preview/pipeline/cardPreviewRequest";
import type { VirtualPreviewBinding } from "card-preview/scheduling/virtualPreviewSurface";
import type {
	MountedFlatGridBuild,
	MountedFlatGridCell,
	MountedFlatGridRow,
} from "./mountedCells";
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

export interface ResolveCardGridBindingsParams<T> {
	mountedBuild: MountedFlatGridBuild<T> | null;
	resolvePreviewRequest?(item: T, index: number): CardPreviewRequest | null;
	resolveInteractionDescriptor?(
		item: T,
		index: number,
	): ItemInteractionDescriptor | null;
}

/** Result of resolving the bindings owned by one mounted-build cache. */
export interface CardGridBindingsMemoResult {
	readonly bindings: CardGridBindings;
	readonly changed: boolean;
}

/** Resolves cached bindings and reports whether consumers must resynchronize. */
export type CardGridBindingsMemo<T> = (
	params: ResolveCardGridBindingsParams<T>,
) => CardGridBindingsMemoResult;

const EMPTY_CARD_GRID_BINDINGS: CardGridBindings = {
	previewBindings: [],
	interactionBindings: [],
};

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

/**
 * Reuses bindings while the mounted build and both resolver identities are stable.
 */
export function createCardGridBindingsMemo<T>(): CardGridBindingsMemo<T> {
	let lastMountedBuild: MountedFlatGridBuild<T> | null | undefined;
	let lastPreviewResolver: ResolveCardGridBindingsParams<T>["resolvePreviewRequest"];
	let lastInteractionResolver: ResolveCardGridBindingsParams<T>["resolveInteractionDescriptor"];
	let bindings = EMPTY_CARD_GRID_BINDINGS;

	return ({
		mountedBuild,
		resolvePreviewRequest,
		resolveInteractionDescriptor,
	}): CardGridBindingsMemoResult => {
		if (
			mountedBuild === lastMountedBuild &&
			resolvePreviewRequest === lastPreviewResolver &&
			resolveInteractionDescriptor === lastInteractionResolver
		) {
			return { bindings, changed: false };
		}

		bindings = buildCardGridBindings({
			rows: mountedBuild?.rowsInMountedRange ?? [],
			resolvePreviewRequest,
			resolveInteractionDescriptor,
		});
		lastMountedBuild = mountedBuild;
		lastPreviewResolver = resolvePreviewRequest;
		lastInteractionResolver = resolveInteractionDescriptor;

		return { bindings, changed: true };
	};
}
