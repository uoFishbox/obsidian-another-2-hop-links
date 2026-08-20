import { describe, expect, it } from "vitest";
import {
	CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
	createCardGridVisibilityPolicy,
} from "../cardGridVisibilityPolicy";

describe("card virtual list policy", () => {
	it("uses one preview and mounted overscan row by default", () => {
		expect(
			createCardGridVisibilityPolicy({
				layout: {
					rowHeight: 120,
					gap: 12,
				},
			}),
		).toEqual({
			bootstrapRows: 3,
			mountedOverscanPx: 132,
			previewOverscanPx: 132,
		});
	});

	it("uses one mounted overscan row as the minimum", () => {
		expect(
			createCardGridVisibilityPolicy({
				layout: {
					rowHeight: 120,
					gap: 12,
				},
				previewActivationAheadRows: 0,
			}),
		).toMatchObject({
			mountedOverscanPx: 132,
			previewOverscanPx: 0,
		});
	});

	it("expands mounted overscan when preview overscan is larger", () => {
		expect(
			createCardGridVisibilityPolicy({
				layout: {
					rowHeight: 120,
					gap: 12,
				},
				previewActivationAheadRows: 2,
			}),
		).toMatchObject({
			mountedOverscanPx: 264,
			previewOverscanPx: 264,
		});
	});

	it("exposes the shared unstable measurement retry limit", () => {
		expect(CARD_GRID_BOOTSTRAP_VISIBLE_ROWS).toBe(3);
	});
});
