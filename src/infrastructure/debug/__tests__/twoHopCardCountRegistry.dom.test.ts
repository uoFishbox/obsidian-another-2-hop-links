import { describe, expect, it } from "vitest";
import {
	getTwoHopCardCounts,
	publishTwoHopCardCounts,
} from "infrastructure/debug/twoHopCardCountRegistry";

describe("twoHopCardCountRegistry", () => {
	it("keeps an immutable logical count snapshot per surface root", () => {
		const firstRoot = document.createElement("div");
		const secondRoot = document.createElement("div");
		const counts = { header: 2, item: 8, loadMore: 1, total: 11 };

		publishTwoHopCardCounts(firstRoot, counts);
		counts.item = 10;

		expect(getTwoHopCardCounts(firstRoot)).toEqual({
			header: 2,
			item: 8,
			loadMore: 1,
			total: 11,
		});
		expect(getTwoHopCardCounts(secondRoot)).toBeNull();
	});
});
