import type { VirtualVisibilityPolicy } from "./core/virtualListEngine";

export const CARD_VIRTUAL_LIST_BOOTSTRAP_VISIBLE_ROWS = 3;
export const CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES = 6;

export interface CreateCardVirtualListPolicyParams {
	layout: {
		columns?: number;
		rowHeight: number;
		gap: number;
	};
	previewActivationAheadRows?: number;
}

export function createCardVirtualListPolicy({
	layout,
	previewActivationAheadRows = 1,
}: CreateCardVirtualListPolicyParams): VirtualVisibilityPolicy {
	const rowOverscanPx = Math.max(0, layout.rowHeight + layout.gap);
	const minimumMountedOverscanPx = rowOverscanPx;
	const aheadRows = Math.max(0, Math.floor(previewActivationAheadRows));
	const previewOverscanPx = rowOverscanPx * aheadRows;

	return {
		bootstrapRows: CARD_VIRTUAL_LIST_BOOTSTRAP_VISIBLE_ROWS,
		mountedOverscanPx: Math.max(minimumMountedOverscanPx, previewOverscanPx),
		previewOverscanPx,
	};
}
