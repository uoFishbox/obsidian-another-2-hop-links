import { createCardVirtualListPolicy } from "../cardVirtualListPolicy";
import type { ViewPlanLayoutMetrics } from "./viewPlanLayout";

type ViewPlanCardVirtualListPolicy = ReturnType<
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
	let cachedPolicyPreviewActivationAheadRows: number | undefined;
	let cachedPolicyIsScrollActive: boolean | undefined;
	let cachedPolicy: ViewPlanCardVirtualListPolicy | undefined;

	return {
		resolve(layout, isScrollActive) {
			const previewActivationAheadRows =
				params.getPreviewActivationAheadRows();

			if (
				cachedPolicy &&
				cachedPolicyRowHeight === layout.rowHeight &&
				cachedPolicyGap === layout.gap &&
				cachedPolicyPreviewActivationAheadRows ===
					previewActivationAheadRows &&
				cachedPolicyIsScrollActive === isScrollActive
			) {
				return cachedPolicy;
			}

			cachedPolicyRowHeight = layout.rowHeight;
			cachedPolicyGap = layout.gap;
			cachedPolicyPreviewActivationAheadRows =
				previewActivationAheadRows;
			cachedPolicyIsScrollActive = isScrollActive;
			cachedPolicy = createCardVirtualListPolicy({
				layout,
				previewActivationAheadRows,
			});
			return cachedPolicy;
		},
	};
}
