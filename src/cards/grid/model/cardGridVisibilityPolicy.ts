import type { VirtualVisibilityPolicy } from "cards/virtualization/public";

export const CARD_GRID_BOOTSTRAP_VISIBLE_ROWS = 3;
const CARD_GRID_MOUNTED_OVERSCAN_ROWS = 2;

export type CardGridVisibilityPolicyResolver = (
	rowStride: number,
) => VirtualVisibilityPolicy;

/** Creates a policy resolver that reuses its result while row stride is unchanged. */
export function createCardGridVisibilityPolicyResolver(): CardGridVisibilityPolicyResolver {
	let cachedRowStride: number | undefined;
	let cachedPolicy: VirtualVisibilityPolicy | undefined;

	return (rowStride): VirtualVisibilityPolicy => {
		const normalizedRowStride = Math.max(0, rowStride);
		if (cachedPolicy && cachedRowStride === normalizedRowStride) {
			return cachedPolicy;
		}

		cachedRowStride = normalizedRowStride;
		cachedPolicy = {
			bootstrapRows: CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
			mountedOverscanPx: normalizedRowStride * CARD_GRID_MOUNTED_OVERSCAN_ROWS,
			previewOverscanPx: 0,
		};
		return cachedPolicy;
	};
}
