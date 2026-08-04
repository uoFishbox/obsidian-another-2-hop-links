import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import type { RowRange } from "ui/virtualization/rowRange";

export interface RowPreviewCardBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly request: CardPreviewRequest;
	/**
	 * Stable logical identity of the card owning this slot. Must survive
	 * source regeneration (e.g. `load more`) so an unchanged card does not
	 * rebind its preview host. Preview cache identities must not be used to
	 * prove ownership of a physical host.
	 */
	readonly ownerKey: string;
}

export interface RowPreviewWindow {
	readonly previewRange: RowRange;
	readonly active: boolean;
}

/** Immutable preview projection published as part of one atomic frame. */
export interface PreviewFrame {
	readonly previewBindingsBySlot: ReadonlyMap<string, RowPreviewCardBinding>;
	readonly previewWindow: RowPreviewWindow;
}
