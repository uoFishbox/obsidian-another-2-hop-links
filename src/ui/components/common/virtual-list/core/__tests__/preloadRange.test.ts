import { describe, expect, it } from "vitest";
import { isContentBottomInPreloadRangeFromMetrics } from "../preloadRange";

describe("isContentBottomInPreloadRangeFromMetrics", () => {
	it("uses shared scroll metrics without requiring DOM reads", () => {
		expect(
			isContentBottomInPreloadRangeFromMetrics({
				contentHeight: 400,
				rootMargin: "0px 0px 100px 0px",
				scrollTop: 200,
				viewportHeight: 500,
				sectionTop: 350,
			}),
		).toBe(true);

		expect(
			isContentBottomInPreloadRangeFromMetrics({
				contentHeight: 401,
				rootMargin: "0px 0px 100px 0px",
				scrollTop: 200,
				viewportHeight: 500,
				sectionTop: 400,
			}),
		).toBe(false);
	});
});
