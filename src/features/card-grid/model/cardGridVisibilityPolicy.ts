import type { VirtualVisibilityPolicy } from "ui/virtualization/public";

export const CARD_GRID_BOOTSTRAP_VISIBLE_ROWS = 3;

export interface CreateCardGridVisibilityPolicyParams {
	layout: {
		columns?: number;
		rowHeight: number;
		gap: number;
	};
	previewActivationAheadRows?: number;
}

export function createCardGridVisibilityPolicy({
	layout,
	previewActivationAheadRows = 1,
}: CreateCardGridVisibilityPolicyParams): VirtualVisibilityPolicy {
	const rowOverscanPx = Math.max(0, layout.rowHeight + layout.gap);
	const minimumMountedOverscanPx = rowOverscanPx;
	const aheadRows = Math.max(0, Math.floor(previewActivationAheadRows));
	const previewOverscanPx = rowOverscanPx * aheadRows;

	return {
		bootstrapRows: CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
		mountedOverscanPx: Math.max(minimumMountedOverscanPx, previewOverscanPx),
		previewOverscanPx,
	};
}
