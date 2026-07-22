import { createCardVirtualListPolicy } from "../cardVirtualListPolicy";
import type { ViewPlanLayoutMetrics } from "./viewPlanLayout";

export type ViewPlanCardVirtualListPolicy = ReturnType<
	typeof createCardVirtualListPolicy
>;

export interface ViewPlanCardVirtualListPolicyResolver {
	resolve(
		layout: ViewPlanLayoutMetrics,
		isScrollActive: boolean,
	): ViewPlanCardVirtualListPolicy;
}

export function createViewPlanCardVirtualListPolicyResolver(params: {
	getPreviewActivationAheadRows(): number;
}): ViewPlanCardVirtualListPolicyResolver {
	let cachedPolicyRowHeight: number | undefined;
	let cachedPolicyGap: number | undefined;
	let cachedPolicyEffectiveAheadRows: number | undefined;
	let cachedPolicy: ViewPlanCardVirtualListPolicy | undefined;

	return {
		resolve(layout, isScrollActive) {
			const configuredAheadRows = params.getPreviewActivationAheadRows();
			const effectiveAheadRows = isScrollActive ? 0 : configuredAheadRows;

			if (
				cachedPolicy &&
				cachedPolicyRowHeight === layout.rowHeight &&
				cachedPolicyGap === layout.gap &&
				cachedPolicyEffectiveAheadRows === effectiveAheadRows
			) {
				return cachedPolicy;
			}

			cachedPolicyRowHeight = layout.rowHeight;
			cachedPolicyGap = layout.gap;
			cachedPolicyEffectiveAheadRows = effectiveAheadRows;
			cachedPolicy = createCardVirtualListPolicy({
				layout,
				previewActivationAheadRows: effectiveAheadRows,
			});
			return cachedPolicy;
		},
	};
}
