import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type { RowRange } from "ui/virtualization/rowRange";

export interface RowPreviewCardBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly request: CardPreviewRequest;
	/**
	 * Opaque desired-state reference. Preview cache identities must not be used
	 * to prove ownership of a physical host.
	 */
	readonly ownerToken: object;
}

export interface RowPreviewBindingDelta {
	readonly enteredSlots: readonly RowPreviewCardBinding[];
	readonly reboundSlots: readonly RowPreviewCardBinding[];
	readonly releasedSlots: readonly string[];
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
