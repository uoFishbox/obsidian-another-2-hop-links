import { describe, expect, it } from "vitest";
import {
	CARD_GRID_BOOTSTRAP_VISIBLE_ROWS,
	createCardGridVisibilityPolicyResolver,
} from "../cardGridVisibilityPolicy";

describe("card virtual list policy", () => {
	it("mounts two prefetch rows while keeping render overscan at zero", () => {
		const resolvePolicy = createCardGridVisibilityPolicyResolver();
		expect(resolvePolicy(132)).toEqual({
			bootstrapRows: 3,
			mountedOverscanPx: 264,
			previewOverscanPx: 0,
		});
	});

	it("reuses the policy while row stride is unchanged", () => {
		const resolvePolicy = createCardGridVisibilityPolicyResolver();
		const first = resolvePolicy(132);

		expect(resolvePolicy(132)).toBe(first);
		expect(resolvePolicy(144)).not.toBe(first);
	});

	it("exposes the shared unstable measurement retry limit", () => {
		expect(CARD_GRID_BOOTSTRAP_VISIBLE_ROWS).toBe(3);
	});
});
