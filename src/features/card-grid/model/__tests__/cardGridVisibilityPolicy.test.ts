import { describe, expect, it } from "vitest";
import {
	CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
	createCardGridVisibilityPolicy,
} from "../../runtime/flat-grid/useFlatCardGrid.svelte";

describe("card virtual list policy", () => {
	it("uses one preview and mounted overscan row by default", () => {
		expect(createCardGridVisibilityPolicy({ rowHeight: 120, gap: 12 })).toEqual({
			bootstrapRows: 3,
			mountedOverscanPx: 132,
			previewOverscanPx: 132,
		});
	});

	it("exposes the shared unstable measurement retry limit", () => {
		expect(CARD_GRID_BOOTSTRAP_VISIBLE_ROWS).toBe(3);
	});
});
