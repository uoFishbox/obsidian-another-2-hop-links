import { describe, expect, it, vi } from "vitest";
import {
	buildScopedSectionId,
	computeInitialVisibleCount,
	createCompactSectionId,
	normalizeIncrement,
} from "ui/components/common/listPagination";
import { createSectionPaginationState } from "features/card-grid/pagination/sectionPagination";

describe("listPagination", () => {
	it("clamps the initial visible count to the available items", () => {
		expect(computeInitialVisibleCount(10, undefined)).toBe(10);
		expect(computeInitialVisibleCount(10, Number.NaN)).toBe(10);
		expect(computeInitialVisibleCount(10, 3.9)).toBe(3);
		expect(computeInitialVisibleCount(10, 20)).toBe(10);
		expect(computeInitialVisibleCount(10, -2)).toBe(0);
	});

	it("normalizes load more increments", () => {
		expect(normalizeIncrement(undefined)).toBe(Number.POSITIVE_INFINITY);
		expect(normalizeIncrement(Number.NaN)).toBe(Number.POSITIVE_INFINITY);
		expect(normalizeIncrement(4.9)).toBe(4);
		expect(normalizeIncrement(0)).toBe(Number.POSITIVE_INFINITY);
		expect(normalizeIncrement(-1)).toBe(Number.POSITIVE_INFINITY);
	});

	it("loads more and stores the updated expanded limit", () => {
		let expandedLimits: Record<string, number> = {};
		const applicationStore = {
			getDefaultSectionVisibleLimit: vi.fn(() => 2),
			getSectionExpandedLimit: vi.fn(
				(sectionId: string) => expandedLimits[sectionId],
			),
			setSectionExpandedLimit: vi.fn(),
		};
		const pagination = createSectionPaginationState({
			getExpandedLimits: () => expandedLimits,
			setExpandedLimits: (nextExpandedLimits) => {
				expandedLimits = nextExpandedLimits;
			},
			applicationStore: applicationStore as any,
			loadMoreIncrement: 3,
		});

		expect(pagination.getVisibleCount("section", 10)).toBe(2);

		pagination.loadMore("section", 10);

		expect(expandedLimits.section).toBe(5);
		expect(applicationStore.setSectionExpandedLimit).toHaveBeenCalledWith(
			"section",
			5,
		);
	});

	it("normalizes NaN expanded limits to zero", () => {
		let expandedLimits: Record<string, number> = {
			section: Number.NaN,
		};
		const pagination = createSectionPaginationState({
			getExpandedLimits: () => expandedLimits,
			setExpandedLimits: (nextExpandedLimits) => {
				expandedLimits = nextExpandedLimits;
			},
			initialVisibleCount: 0,
		});

		expect(pagination.getVisibleCount("section", 10)).toBe(0);
	});

	it("clamps stored and store-provided expanded limits to loaded items", () => {
		const applicationStore = {
			getDefaultSectionVisibleLimit: vi.fn(() => 0),
			getSectionExpandedLimit: vi.fn(() => 100),
			setSectionExpandedLimit: vi.fn(),
		};
		const pagination = createSectionPaginationState({
			getExpandedLimits: () => ({ stored: 100 }),
			setExpandedLimits: vi.fn(),
			applicationStore: applicationStore as any,
			initialVisibleCount: 100,
		});

		expect(pagination.getVisibleCount("stored", 5)).toBe(5);
		expect(pagination.getVisibleCount("from-store", 5)).toBe(5);
	});

	it("falls back when the provided store does not expose pagination methods", () => {
		let expandedLimits: Record<string, number> = {};
		const pagination = createSectionPaginationState({
			getExpandedLimits: () => expandedLimits,
			setExpandedLimits: (nextExpandedLimits) => {
				expandedLimits = nextExpandedLimits;
			},
			applicationStore: {} as any,
			initialVisibleCount: 2,
			loadMoreIncrement: 3,
		});

		expect(pagination.getVisibleCount("section", 10)).toBe(2);

		pagination.loadMore("section", 10);

		expect(expandedLimits.section).toBe(5);
	});
});

describe("buildScopedSectionId", () => {
	it("is injective for scoped values", () => {
		expect(buildScopedSectionId("a::scope:b", "c")).not.toBe(
			buildScopedSectionId("a", "b::scope:c"),
		);
	});

	it("produces different keys for different section ids with same scope", () => {
		expect(buildScopedSectionId("section-a", "search")).not.toBe(
			buildScopedSectionId("section-b", "search"),
		);
	});

	it("produces different keys for same section id with different scopes", () => {
		expect(buildScopedSectionId("section", "search-a")).not.toBe(
			buildScopedSectionId("section", "search-b"),
		);
	});

	it("produces consistent keys for same inputs", () => {
		expect(buildScopedSectionId("section", "search")).toBe(
			buildScopedSectionId("section", "search"),
		);
	});

	it("handles empty scope consistently", () => {
		expect(buildScopedSectionId("section", "")).toBe(
			buildScopedSectionId("section", null),
		);
		expect(buildScopedSectionId("section", "")).toBe(
			buildScopedSectionId("section", undefined),
		);
		expect(buildScopedSectionId("section", "  ")).toBe(
			buildScopedSectionId("section", ""),
		);
	});

	it("handles section id containing delimiter characters", () => {
		const keyA = buildScopedSectionId("a|b", "c");
		const keyB = buildScopedSectionId("a", "b|c");
		expect(keyA).not.toBe(keyB);
	});
});

describe("createCompactSectionId", () => {
	it("keeps long identities out of section ids", () => {
		const identity =
			"19:Data_Dictionary2.md|16:Data_Dictionary2|29:position:10:81:226:10:101:246";
		const sectionId = createCompactSectionId("twohop", identity);

		expect(sectionId).toMatch(/^twohop-[0-9a-z]+-[0-9a-z]+$/);
		expect(sectionId).not.toContain("Data_Dictionary2");
		expect(sectionId.length).toBeLessThan(identity.length);
	});

	it("produces stable, distinct ids for distinct identities", () => {
		const identityA = "19:Data_Dictionary2.md|16:Data_Dictionary2|p:6a:6u";
		const identityB = "19:Data_Dictionary2.md|16:Data_Dictionary2|p:6b:6v";

		expect(createCompactSectionId("twohop", identityA)).toBe(
			createCompactSectionId("twohop", identityA),
		);
		expect(createCompactSectionId("twohop", identityA)).not.toBe(
			createCompactSectionId("twohop", identityB),
		);
	});
});
