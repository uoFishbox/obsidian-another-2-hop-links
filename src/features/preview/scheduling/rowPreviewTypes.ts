import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
import type { RowRange } from "ui/virtualization/rowRange";

export interface RowPreviewCardBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly snapshot: CardPreviewSnapshot;
	/**
	 * Opaque desired-state reference. Preview cache identities must not be used
	 * to prove ownership of a physical host.
	 */
	readonly currentnessToken?: object;
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

/** Preview projection published as part of an atomic virtual frame. */
export interface VirtualPreviewCommittedFrame {
	readonly previewBindingsBySlot: ReadonlyMap<string, RowPreviewCardBinding>;
	readonly previewWindow: RowPreviewWindow;
}

/** Stable source whose current frame changes through one reference assignment. */
export interface VirtualPreviewCommittedFrameSource {
	readonly current: VirtualPreviewCommittedFrame;
}
