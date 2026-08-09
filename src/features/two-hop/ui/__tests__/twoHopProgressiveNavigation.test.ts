import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_PLAN_LAYOUT } from "ui/virtualization/svelte/viewPlanLayout";
import { compileFixedGridLayout } from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	compileTwoHopProgressivePlan,
	resolveInitialProgressiveMountedRowEnd,
} from "features/two-hop/ui/twoHopProgressivePlan";
import { resolveTwoHopProgressiveNavigationTarget } from "features/two-hop/ui/twoHopProgressiveNavigation";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "features/two-hop/ui/twoHopSectionModel";

function createPlan(itemCount: number) {
	const section = createTwoHopSectionModel({
		id: "section",
		key: "section",
		kind: "new-links-section",
		title: "Section",
		items: Array.from({ length: itemCount }, (_, index) => ({
			kind: "new-link",
			item: { type: "newLink" },
			searchKey: `item:${index}`,
			key: `item:${index}`,
		})) as TwoHopItemModel[],
	});
	const layout = { ...DEFAULT_VIEW_PLAN_LAYOUT, columns: 1 };
	const geometry = compileFixedGridLayout([section], layout);
	return compileTwoHopProgressivePlan(
		[section],
		geometry,
		resolveInitialProgressiveMountedRowEnd(geometry.rowCount),
	);
}

describe("resolveTwoHopProgressiveNavigationTarget", () => {
	it("resolves the next row beyond the mounted prefix", () => {
		const plan = createPlan(80);
		expect(plan.mountedRowEnd).toBe(32);

		expect(
			resolveTwoHopProgressiveNavigationTarget(
				plan,
				"item:section:item:30",
				"down",
				{ rowIndex: 31, columnIndex: 0 },
			),
		).toMatchObject({
			key: "item:section:item:31",
			rowIndex: 32,
		});
	});
});
