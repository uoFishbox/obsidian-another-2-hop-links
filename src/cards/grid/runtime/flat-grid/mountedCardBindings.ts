import {
	applyCardPreviewDimensions,
	type CardPreviewRequest,
} from "card-preview/pipeline/cardPreviewRequest";
import type { PreviewCardDimensions } from "card-preview/pipeline/previewRenderSettings";
import type { VirtualPreviewBinding } from "card-preview/scheduling/virtualPreviewSurface";
import type {
	MountedFlatGridBuild,
	MountedFlatGridCell,
	MountedFlatGridRow,
} from "./mountedRows";
import type { FlatGridLogicalCell } from "./logicalCell";
import type { ItemInteractionDescriptor } from "cards/interactions/interactionTypes";
import type { VirtualCardInteractionBinding } from "cards/interactions/virtualCardInteractionController";

export type MountedFlatGridItemCell<T> = MountedFlatGridCell<T> & {
	readonly cell: Extract<FlatGridLogicalCell<T>, { kind: "item" }>;
};

/** Derived bindings committed with a mounted card-grid snapshot. */
export interface FlatGridCardBindings {
	readonly previewBindings: VirtualPreviewBinding[];
	readonly interactionBindings: VirtualCardInteractionBinding[];
}

export interface BuildFlatGridCardBindingsParams<T> {
	rows: readonly MountedFlatGridRow<T>[];
	previewCardDimensions: PreviewCardDimensions;
	resolvePreviewRequest?(item: T, index: number): CardPreviewRequest | null;
	resolveInteractionDescriptor?(
		item: T,
		index: number,
	): ItemInteractionDescriptor | null;
}

export interface ResolveFlatGridCardBindingsParams<T> {
	mountedBuild: MountedFlatGridBuild<T> | null;
	previewCardDimensions: PreviewCardDimensions;
	resolvePreviewRequest?(item: T, index: number): CardPreviewRequest | null;
	resolveInteractionDescriptor?(
		item: T,
		index: number,
	): ItemInteractionDescriptor | null;
}

/** Result of resolving the bindings owned by one mounted-build cache. */
export interface FlatGridCardBindingsMemoResult {
	readonly bindings: FlatGridCardBindings;
	readonly changed: boolean;
}

/** Resolves cached bindings and reports whether consumers must resynchronize. */
export type FlatGridCardBindingsMemo<T> = (
	params: ResolveFlatGridCardBindingsParams<T>,
) => FlatGridCardBindingsMemoResult;

const EMPTY_FLAT_GRID_CARD_BINDINGS: FlatGridCardBindings = {
	previewBindings: [],
	interactionBindings: [],
};

export function isMountedFlatGridItemCell<T>(
	mountedCell: MountedFlatGridCell<T> | null | undefined,
): mountedCell is MountedFlatGridItemCell<T> {
	return mountedCell?.cell.kind === "item";
}

/** Resolves immutable preview and interaction bindings from mounted card rows. */
export function buildFlatGridCardBindings<T>({
	rows,
	previewCardDimensions,
	resolvePreviewRequest,
	resolveInteractionDescriptor,
}: BuildFlatGridCardBindingsParams<T>): FlatGridCardBindings {
	const previewBindings: VirtualPreviewBinding[] = [];
	const interactionBindings: VirtualCardInteractionBinding[] = [];

	for (const row of rows) {
		for (const mountedCell of row.bindings) {
			if (!isMountedFlatGridItemCell(mountedCell)) continue;
			const { item, itemIndex } = mountedCell.cell;
			const basePreviewRequest = resolvePreviewRequest?.(item, itemIndex);
			if (basePreviewRequest) {
				previewBindings.push({
					key: String(mountedCell.key),
					rowIndex: mountedCell.rowIndex,
					request: applyCardPreviewDimensions(
						basePreviewRequest,
						previewCardDimensions,
					),
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
export function createFlatGridCardBindingsMemo<T>(): FlatGridCardBindingsMemo<T> {
	let lastMountedBuild: MountedFlatGridBuild<T> | null | undefined;
	let lastPreviewResolver: ResolveFlatGridCardBindingsParams<T>["resolvePreviewRequest"];
	let lastInteractionResolver: ResolveFlatGridCardBindingsParams<T>["resolveInteractionDescriptor"];
	let lastPreviewWidthPx: number | undefined;
	let lastPreviewHeightPx: number | undefined;
	let bindings = EMPTY_FLAT_GRID_CARD_BINDINGS;

	return ({
		mountedBuild,
		previewCardDimensions,
		resolvePreviewRequest,
		resolveInteractionDescriptor,
	}): FlatGridCardBindingsMemoResult => {
		if (
			mountedBuild === lastMountedBuild &&
			resolvePreviewRequest === lastPreviewResolver &&
			resolveInteractionDescriptor === lastInteractionResolver &&
			previewCardDimensions.widthPx === lastPreviewWidthPx &&
			previewCardDimensions.heightPx === lastPreviewHeightPx
		) {
			return { bindings, changed: false };
		}

		bindings = buildFlatGridCardBindings({
			rows: mountedBuild?.rowsInMountedRange ?? [],
			previewCardDimensions,
			resolvePreviewRequest,
			resolveInteractionDescriptor,
		});
		lastMountedBuild = mountedBuild;
		lastPreviewResolver = resolvePreviewRequest;
		lastInteractionResolver = resolveInteractionDescriptor;
		lastPreviewWidthPx = previewCardDimensions.widthPx;
		lastPreviewHeightPx = previewCardDimensions.heightPx;

		return { bindings, changed: true };
	};
}
