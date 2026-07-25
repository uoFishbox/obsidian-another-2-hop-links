import {
	createCardVirtualListPolicy,
	type MountedOverscanRows,
} from "../cardVirtualListPolicy";
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
	getMountedOverscanRows(): MountedOverscanRows;
}): ViewPlanCardVirtualListPolicyResolver {
	let cachedPolicyRowHeight: number | undefined;
	let cachedPolicyGap: number | undefined;
	let cachedPolicyAheadRows: number | undefined;
	let cachedMountedOverscanRows: MountedOverscanRows | undefined;
	let cachedPolicy: ViewPlanCardVirtualListPolicy | undefined;

	return {
		resolve(layout, _isScrollActive) {
			const configuredAheadRows = params.getPreviewActivationAheadRows();
			const configuredMountedOverscanRows = params.getMountedOverscanRows();

			if (
				cachedPolicy &&
				cachedPolicyRowHeight === layout.rowHeight &&
				cachedPolicyGap === layout.gap &&
				cachedPolicyAheadRows === configuredAheadRows &&
				cachedMountedOverscanRows === configuredMountedOverscanRows
			) {
				return cachedPolicy;
			}

			cachedPolicyRowHeight = layout.rowHeight;
			cachedPolicyGap = layout.gap;
			cachedPolicyAheadRows = configuredAheadRows;
			cachedMountedOverscanRows = configuredMountedOverscanRows;
			cachedPolicy = createCardVirtualListPolicy({
				layout,
				previewActivationAheadRows: configuredAheadRows,
				mountedOverscanRows: configuredMountedOverscanRows,
			});
			return cachedPolicy;
		},
	};
}
