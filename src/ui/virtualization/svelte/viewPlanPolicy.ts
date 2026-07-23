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
	let cachedPolicyAheadRows: number | undefined;
	let cachedPolicy: ViewPlanCardVirtualListPolicy | undefined;

	return {
		resolve(layout, _isScrollActive) {
			const configuredAheadRows = params.getPreviewActivationAheadRows();

			if (
				cachedPolicy &&
				cachedPolicyRowHeight === layout.rowHeight &&
				cachedPolicyGap === layout.gap &&
				cachedPolicyAheadRows === configuredAheadRows
			) {
				return cachedPolicy;
			}

			cachedPolicyRowHeight = layout.rowHeight;
			cachedPolicyGap = layout.gap;
			cachedPolicyAheadRows = configuredAheadRows;
			cachedPolicy = createCardVirtualListPolicy({
				layout,
				previewActivationAheadRows: configuredAheadRows,
			});
			return cachedPolicy;
		},
	};
}
