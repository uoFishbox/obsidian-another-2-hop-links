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

export type MountedFlatGridItemCell<T> = MountedFlatGridCell<T> & {
	readonly cell: Extract<FlatGridLogicalCell<T>, { kind: "item" }>;
};

/** Derived bindings committed with a mounted card-grid snapshot. */
export interface FlatGridCardBindings {
	readonly previewBindings: VirtualPreviewBinding[];
}

export interface BuildFlatGridCardBindingsParams<T> {
	rows: readonly MountedFlatGridRow<T>[];
	previewCardDimensions: PreviewCardDimensions;
	resolvePreviewRequest?(item: T, index: number): CardPreviewRequest | null;
}

export interface ResolveFlatGridCardBindingsParams<T> {
	mountedBuild: MountedFlatGridBuild<T> | null;
	previewCardDimensions: PreviewCardDimensions;
	resolvePreviewRequest?(item: T, index: number): CardPreviewRequest | null;
}

/** Resolves cached preview bindings for one mounted build. */
export type FlatGridCardBindingsMemo<T> = (
	params: ResolveFlatGridCardBindingsParams<T>,
) => FlatGridCardBindings;

const EMPTY_FLAT_GRID_CARD_BINDINGS: FlatGridCardBindings = {
	previewBindings: [],
};

export function isMountedFlatGridItemCell<T>(
	mountedCell: MountedFlatGridCell<T> | null | undefined,
): mountedCell is MountedFlatGridItemCell<T> {
	return mountedCell?.cell.kind === "item";
}

/** Resolves immutable preview bindings from mounted card rows. */
export function buildFlatGridCardBindings<T>({
	rows,
	previewCardDimensions,
	resolvePreviewRequest,
}: BuildFlatGridCardBindingsParams<T>): FlatGridCardBindings {
	const previewBindings: VirtualPreviewBinding[] = [];

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
		}
	}

	return {
		previewBindings,
	};
}

/**
 * Reuses bindings while the mounted build and preview inputs are stable.
 */
export function createFlatGridCardBindingsMemo<T>(): FlatGridCardBindingsMemo<T> {
	let lastMountedBuild: MountedFlatGridBuild<T> | null | undefined;
	let lastPreviewResolver: ResolveFlatGridCardBindingsParams<T>["resolvePreviewRequest"];
	let lastPreviewWidthPx: number | undefined;
	let lastPreviewHeightPx: number | undefined;
	let bindings = EMPTY_FLAT_GRID_CARD_BINDINGS;

	return ({
		mountedBuild,
		previewCardDimensions,
		resolvePreviewRequest,
	}): FlatGridCardBindings => {
		if (
			mountedBuild === lastMountedBuild &&
			resolvePreviewRequest === lastPreviewResolver &&
			previewCardDimensions.widthPx === lastPreviewWidthPx &&
			previewCardDimensions.heightPx === lastPreviewHeightPx
		) {
			return bindings;
		}

		bindings = buildFlatGridCardBindings({
			rows: mountedBuild?.rowsInMountedRange ?? [],
			previewCardDimensions,
			resolvePreviewRequest,
		});
		lastMountedBuild = mountedBuild;
		lastPreviewResolver = resolvePreviewRequest;
		lastPreviewWidthPx = previewCardDimensions.widthPx;
		lastPreviewHeightPx = previewCardDimensions.heightPx;

		return bindings;
	};
}
