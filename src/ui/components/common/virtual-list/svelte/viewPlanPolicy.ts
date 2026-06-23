import { createCardVirtualListPolicy } from "../cardVirtualListPolicy";
import type { ViewPlanLayoutMetrics } from "./viewPlanLayout";

type ViewPlanCardVirtualListPolicy = ReturnType<typeof createCardVirtualListPolicy>;

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
			// During active scroll the preview scheduler suppresses activation
			// via the scroll-activity gate, so ahead rows only inflate the
			// preview-visible range without pre-rendering anything. Dropping
			// them to 0 during scroll keeps the mount buffer at one row
			// (mountedOverscanPx = max(rowOverscanPx, 0) = rowOverscanPx) but
			// shrinks previewVisible to the strict viewport, so overscan buffer
			// cells stay visibility="mounted" and skip the expensive CardPreview
			// mount (new Component(); component.load()) per scroll frame. Idle
			// measurements restore the configured ahead rows for smooth
			// scroll-into-view pre-activation.
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
