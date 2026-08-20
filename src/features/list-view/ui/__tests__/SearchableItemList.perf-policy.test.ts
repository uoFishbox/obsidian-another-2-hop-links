import { describe, expect, it } from "vitest";
import {
	SEARCH_FILTER_YIELD_CHECK_INTERVAL,
	SEARCH_FILTER_YIELD_MAX_DELAY_MS,
} from "features/list-view/runtime/searchFilterTimeSlicing";

/**
 * Pins the exact time-slicing policy of the SearchableItemList filter loop.
 * Component tests only assert the behavioral guarantee (a large search yields
 * before completing); the concrete budget values live here as the performance
 * contract.
 */
describe("SearchableItemList filter loop performance policy", () => {
	it("re-checks the time budget every 128 items", () => {
		expect(SEARCH_FILTER_YIELD_CHECK_INTERVAL).toBe(128);
	});

	it("yields after at most 16ms of filtering work", () => {
		expect(SEARCH_FILTER_YIELD_MAX_DELAY_MS).toBe(16);
	});

	it("keeps the check interval a power of two for cheap modulo checks", () => {
		expect(SEARCH_FILTER_YIELD_CHECK_INTERVAL).toBeGreaterThan(0);
		expect(
			SEARCH_FILTER_YIELD_CHECK_INTERVAL &
				(SEARCH_FILTER_YIELD_CHECK_INTERVAL - 1),
		).toBe(0);
	});
});
