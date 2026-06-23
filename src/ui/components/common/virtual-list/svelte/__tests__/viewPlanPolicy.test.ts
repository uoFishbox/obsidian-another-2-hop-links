import { describe, expect, it } from "vitest";
import { createViewPlanCardVirtualListPolicyResolver } from "../viewPlanPolicy";
import type { ViewPlanLayoutMetrics } from "../viewPlanLayout";

const layout = (
	overrides: Partial<ViewPlanLayoutMetrics> = {},
): ViewPlanLayoutMetrics => ({
	containerWidth: 800,
	columns: 3,
	cellWidth: 256,
	rowHeight: 120,
	gap: 12,
	sectionMarginBottom: 16,
	...overrides,
});

describe("createViewPlanCardVirtualListPolicyResolver", () => {
	it("uses configured ahead rows when idle", () => {
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => 1,
		});

		expect(resolver.resolve(layout(), false)).toMatchObject({
			mountedOverscanPx: 132,
			previewOverscanPx: 132,
		});
	});

	it("drops preview overscan to 0 during active scroll while keeping one mounted overscan row", () => {
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => 1,
		});

		expect(resolver.resolve(layout(), true)).toMatchObject({
			mountedOverscanPx: 132,
			previewOverscanPx: 0,
		});
	});

	it("narrows mounted overscan to one row during scroll for users with larger ahead rows", () => {
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => 3,
		});

		expect(resolver.resolve(layout(), false)).toMatchObject({
			mountedOverscanPx: 132 * 3,
			previewOverscanPx: 132 * 3,
		});
		expect(resolver.resolve(layout(), true)).toMatchObject({
			mountedOverscanPx: 132,
			previewOverscanPx: 0,
		});
	});

	it("returns the cached policy object for repeated identical inputs", () => {
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => 2,
		});
		const baseLayout = layout();

		const idlePolicy = resolver.resolve(baseLayout, false);
		expect(resolver.resolve(baseLayout, false)).toBe(idlePolicy);
	});

	it("rebuilds the policy when scroll activity flips", () => {
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => 2,
		});
		const baseLayout = layout();

		const idlePolicy = resolver.resolve(baseLayout, false);
		const scrollPolicy = resolver.resolve(baseLayout, true);

		expect(scrollPolicy).not.toBe(idlePolicy);
		expect(scrollPolicy.previewOverscanPx).toBe(0);
		expect(idlePolicy.previewOverscanPx).toBe(264);
	});

	it("rebuilds the policy when the configured ahead rows change", () => {
		let aheadRows = 1;
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => aheadRows,
		});
		const baseLayout = layout();

		const first = resolver.resolve(baseLayout, false);
		aheadRows = 0;
		const second = resolver.resolve(baseLayout, false);

		expect(second).not.toBe(first);
		expect(second.previewOverscanPx).toBe(0);
	});

	it("rebuilds the policy when row height changes", () => {
		const resolver = createViewPlanCardVirtualListPolicyResolver({
			getPreviewActivationAheadRows: () => 1,
		});

		const first = resolver.resolve(layout({ rowHeight: 120 }), false);
		const second = resolver.resolve(layout({ rowHeight: 200 }), false);

		expect(second).not.toBe(first);
		expect(second.mountedOverscanPx).toBe(212);
	});
});
