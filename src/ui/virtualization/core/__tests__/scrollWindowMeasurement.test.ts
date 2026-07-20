import { describe, expect, it, vi } from "vitest";
import {
	createVirtualScrollWindowRangeResolver,
	type VirtualScrollWindowRangeRowModel,
} from "../scrollWindowMeasurement";
import type { VirtualVisibilityPolicy } from "../virtualListEngine";

function createRowModel(
	findVisibleRangeInto: () => void,
): VirtualScrollWindowRangeRowModel {
	return {
		rowCount: 100,
		findVisibleRangeInto(out) {
			findVisibleRangeInto();
			out.start = 10;
			out.end = 20;
		},
		findVisibleRangesInto() {},
		findVisibleRangesFromMountedInto() {},
		findStablePreviewScrollTopBandInto(out) {
			out.min = -1_000;
			out.max = 1_000;
		},
		findStableMountedScrollTopBandInto(out) {
			out.min = -1_000;
			out.max = 1_000;
		},
	};
}

describe("createVirtualScrollWindowRangeResolver", () => {
	it("invalidates the mounted stable band when its measurement inputs change", () => {
		const findVisibleRangeInto = vi.fn();
		const rowModel = createRowModel(findVisibleRangeInto);
		const layout = {};
		const visibilityPolicy: VirtualVisibilityPolicy = {
			bootstrapRows: 1,
			mountedOverscanPx: 10,
			previewOverscanPx: 0,
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => visibilityPolicy,
			resolveStableMountedScrollTopBand: true,
		});

		resolver.resolveMountedScrollWindowMeasurement(100, 100, 0, layout);
		resolver.resolveMountedScrollWindowMeasurement(101, 100, 0, layout);
		expect(findVisibleRangeInto).toHaveBeenCalledTimes(1);

		resolver.resolveMountedScrollWindowMeasurement(102, 120, 0, layout);
		resolver.resolveMountedScrollWindowMeasurement(103, 120, 5, layout);
		visibilityPolicy.mountedOverscanPx = 20;
		resolver.resolveMountedScrollWindowMeasurement(104, 120, 5, layout);

		expect(findVisibleRangeInto).toHaveBeenCalledTimes(4);
	});
});
