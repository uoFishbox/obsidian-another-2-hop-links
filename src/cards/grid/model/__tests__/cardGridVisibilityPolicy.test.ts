import { describe, expect, it } from "vitest";
import {
	CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
	createCardGridVisibilityPolicy,
} from "../../runtime/flat-grid/useFlatCardGrid.svelte";

describe("card virtual list policy", () => {
	it("mounts two prefetch rows while keeping render overscan at zero", () => {
		expect(createCardGridVisibilityPolicy({ rowHeight: 120, gap: 12 })).toEqual({
			bootstrapRows: 3,
			mountedOverscanPx: 264,
			previewOverscanPx: 0,
		});
	});

	it("exposes the shared unstable measurement retry limit", () => {
		expect(CARD_GRID_BOOTSTRAP_VISIBLE_ROWS).toBe(3);
	});
});
