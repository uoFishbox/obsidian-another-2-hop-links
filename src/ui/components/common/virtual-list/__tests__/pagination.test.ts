import { describe, expect, it, vi } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { createSectionVisibleCountsController } from "../pagination";

interface HarnessSection {
	key: string;
}

function createSection(
	sectionId: string,
	loadedCount: number,
): SectionRenderDescriptor<string, HarnessSection> {
	const items = Array.from({ length: loadedCount }, (_, index) => `${index}`);
	return {
		section: { key: sectionId },
		sectionKey: sectionId,
		title: sectionId,
		sectionId,
		totalCount: loadedCount,
		loadedCount,
		getItems: () => items,
		headerProps: {},
	};
}

describe("createSectionVisibleCountsController", () => {
	it("reconciles input without persisting automatic clamp or prune changes", () => {
		const expandedLimits = new Map<string, number>([["section-a", 4]]);
		const setSectionExpandedLimit = vi.fn();
		const controller = createSectionVisibleCountsController<
			string,
			HarnessSection
		>({
			applicationStore: {
				getDefaultSectionVisibleLimit: () => 1,
				getSectionExpandedLimit: (sectionId: string) =>
					expandedLimits.get(sectionId),
				setSectionExpandedLimit,
			} as unknown as ApplicationStore,
			initialVisibleCount: 1,
			loadMoreIncrement: 2,
		});

		const initial = controller.resolveForInput([
			createSection("section-a", 5),
		]);
		expect(initial.snapshot.visibleCounts).toEqual({ "section-a": 4 });
		expect(initial.snapshot.expandedLimits).toEqual({ "section-a": 4 });
		expect(setSectionExpandedLimit).not.toHaveBeenCalled();

		const clamped = controller.resolveForInput([
			createSection("section-a", 3),
		]);
		expect(clamped.snapshot.visibleCounts).toEqual({ "section-a": 3 });
		expect(clamped.snapshot.expandedLimits).toEqual({ "section-a": 4 });
		expect(setSectionExpandedLimit).not.toHaveBeenCalled();

		const pruned = controller.resolveForInput([]);
		expect(pruned.snapshot.visibleCounts).toEqual({});
		expect(pruned.snapshot.expandedLimits).toEqual({});
		expect(setSectionExpandedLimit).not.toHaveBeenCalled();
	});

	it("persists only explicit load-more changes", () => {
		const expandedLimits = new Map<string, number>();
		const setSectionExpandedLimit = vi.fn(
			(sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			},
		);
		const controller = createSectionVisibleCountsController<
			string,
			HarnessSection
		>({
			applicationStore: {
				getDefaultSectionVisibleLimit: () => 2,
				getSectionExpandedLimit: (sectionId: string) =>
					expandedLimits.get(sectionId),
				setSectionExpandedLimit,
			} as unknown as ApplicationStore,
			loadMoreIncrement: 2,
		});

		controller.resolveForInput([createSection("section-a", 5)]);
		const loaded = controller.loadMore("section-a", 5);

		expect(loaded.changed).toBe(true);
		expect(loaded.snapshot.visibleCounts).toEqual({ "section-a": 4 });
		expect(loaded.snapshot.expandedLimits).toEqual({ "section-a": 4 });
		expect(setSectionExpandedLimit).toHaveBeenCalledTimes(1);
		expect(setSectionExpandedLimit).toHaveBeenCalledWith("section-a", 4);
	});

	it("derives visible counts from current loaded count without storing small counts", () => {
		const setSectionExpandedLimit = vi.fn();
		const controller = createSectionVisibleCountsController<
			string,
			HarnessSection
		>({
			applicationStore: {
				getDefaultSectionVisibleLimit: () => 22,
				getSectionExpandedLimit: () => undefined,
				setSectionExpandedLimit,
			} as unknown as ApplicationStore,
			loadMoreIncrement: 22,
		});

		const oneItem = controller.resolveForInput([
			createSection("section-a", 1),
		]);
		expect(oneItem.snapshot.visibleCounts).toEqual({ "section-a": 1 });
		expect(oneItem.snapshot.expandedLimits).toEqual({});

		const twoItems = controller.resolveForInput([
			createSection("section-a", 2),
		]);
		expect(twoItems.snapshot.visibleCounts).toEqual({ "section-a": 2 });
		expect(twoItems.snapshot.expandedLimits).toEqual({});
		expect(setSectionExpandedLimit).not.toHaveBeenCalled();
	});

	it("keeps explicit expanded limits across temporary missing input sections", () => {
		const controller = createSectionVisibleCountsController<
			string,
			HarnessSection
		>({
			initialVisibleCount: 2,
			loadMoreIncrement: 2,
		});

		controller.resolveForInput([createSection("section-a", 6)]);
		controller.loadMore("section-a", 6);

		const absent = controller.resolveForInput([]);
		expect(absent.snapshot.visibleCounts).toEqual({});
		expect(absent.snapshot.expandedLimits).toEqual({});

		const restored = controller.resolveForInput([
			createSection("section-a", 6),
		]);
		expect(restored.snapshot.visibleCounts).toEqual({ "section-a": 4 });
		expect(restored.snapshot.expandedLimits).toEqual({ "section-a": 4 });
	});
});
