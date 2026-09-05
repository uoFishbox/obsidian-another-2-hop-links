import { applyCardPreviewDimensions } from "card-preview/pipeline/cardPreviewRequest";
import type { VirtualPreviewBinding } from "card-preview/scheduling/virtualPreviewSurface";
import type { CardRenderModel } from "cards/rendering/cardRenderModel";
import type { VirtualCardInteractionBinding } from "cards/interactions/virtualCardInteractionController";
import type { RowRange } from "cards/virtualization/public";
import type { TwoHopCardDemand, TwoHopCardHydrationCell } from "./cardHydrator";
import type { MountedTwoHopRow } from "./mountedRows";

/** Builds interaction bindings owned by the current resident physical slots. */
export function buildTwoHopInteractionBindings(
	rows: readonly MountedTwoHopRow[],
	getCardModel: (logicalKey: string) => CardRenderModel | undefined,
): VirtualCardInteractionBinding[] {
	const bindings: VirtualCardInteractionBinding[] = [];
	for (const row of rows) {
		for (const mountedCell of row.bindings) {
			if (!mountedCell || mountedCell.cell.kind !== "item") continue;
			bindings.push({
				slotId: String(mountedCell.physicalCellSlot),
				descriptor:
					getCardModel(mountedCell.cell.logicalKey)?.interactionDescriptor ??
					null,
			});
		}
	}
	return bindings;
}

/** Builds the preview publication for the current resident two-hop window. */
export function buildTwoHopPreviewBindings(
	rows: readonly MountedTwoHopRow[],
	getCardModel: (logicalKey: string) => CardRenderModel | undefined,
	widthPx: number,
	heightPx: number,
	active: boolean,
): VirtualPreviewBinding[] {
	if (!active) return [];

	const bindings: VirtualPreviewBinding[] = [];
	for (const row of rows) {
		for (const mountedCell of row.bindings) {
			if (!mountedCell || mountedCell.cell.kind !== "item") continue;
			const request = getCardModel(mountedCell.cell.logicalKey)?.previewRequest;
			if (!request) continue;

			bindings.push({
				key: mountedCell.cell.logicalKey,
				rowIndex: mountedCell.rowIndex,
				request: applyCardPreviewDimensions(request, { widthPx, heightPx }),
			});
		}
	}
	return bindings;
}

/** Splits resident item cells into hydration priorities for the current ranges. */
export function collectTwoHopCardDemand(
	rows: readonly MountedTwoHopRow[],
	visibleRange: Readonly<RowRange>,
	prefetchRange: Readonly<RowRange>,
	includeBackground: boolean,
): TwoHopCardDemand {
	const foreground: TwoHopCardHydrationCell[] = [];
	const prefetch: TwoHopCardHydrationCell[] = [];
	const background: TwoHopCardHydrationCell[] = [];

	for (const row of rows) {
		for (const mountedCell of row.bindings) {
			if (!mountedCell || mountedCell.cell.kind !== "item") continue;
			if (
				mountedCell.rowIndex >= visibleRange.start &&
				mountedCell.rowIndex < visibleRange.end
			) {
				foreground.push(mountedCell.cell);
			} else if (
				mountedCell.rowIndex >= prefetchRange.start &&
				mountedCell.rowIndex < prefetchRange.end
			) {
				prefetch.push(mountedCell.cell);
			} else if (includeBackground) {
				background.push(mountedCell.cell);
			}
		}
	}

	foreground.push(...prefetch);
	return { foreground, background };
}
