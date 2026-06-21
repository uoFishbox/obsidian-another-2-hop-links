import { describe, expect, it } from "vitest";
import {
	CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES,
	createCardVirtualListPolicy,
} from "../cardVirtualListPolicy";

describe("card virtual list policy", () => {
	it("keeps mounted overscan while scrolling", () => {
		expect(
			createCardVirtualListPolicy({
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

	it("keeps one mounted overscan row for view-plan lists while scrolling", () => {
		expect(
			createCardVirtualListPolicy({
				layout: {
					rowHeight: 120,
					gap: 12,
				},
			}),
		).toMatchObject({
			mountedOverscanPx: 132,
			previewOverscanPx: 132,
		});
	});

	it("keeps preview overscan configurable and within the mounted overscan", () => {
		expect(
			createCardVirtualListPolicy({
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

		expect(
			createCardVirtualListPolicy({
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

	it("keeps view-plan lists fully mounted when scrolling is inactive", () => {
		expect(
			createCardVirtualListPolicy({
				layout: {
					rowHeight: 120,
					gap: 12,
				},
			}),
		).toMatchObject({
			mountedOverscanPx: 132,
		});
	});

	it("exposes the shared unstable measurement retry limit", () => {
		expect(CARD_VIRTUAL_LIST_MAX_UNSTABLE_MEASUREMENT_RETRIES).toBe(6);
	});
});
