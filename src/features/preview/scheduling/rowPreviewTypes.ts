import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
import type { RowRange } from "ui/virtualization/rowRange";

export interface RowPreviewCardBinding {
	readonly slotId: string;
	rowIndex: number;
	snapshot: CardPreviewSnapshot;
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
