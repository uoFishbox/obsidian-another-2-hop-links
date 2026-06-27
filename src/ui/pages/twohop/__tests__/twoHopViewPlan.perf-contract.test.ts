import { describe, expect, it, vi } from "vitest";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import {
	computeVirtualListSnapshotWithState,
	type VirtualListComputation,
} from "ui/components/common/virtual-list/core/virtualListEngine";
import type { MountedFlatCell } from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	type TwoHopViewPlanMaterialization,
	type TwoHopViewPlanRowModel,
} from "../twoHopViewPlan";
import {
	buildTwoHopMountedRows,
	type TwoHopMountedRowsBuild,
} from "../twoHopMountedRowBuild";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";

const CARD_COUNTS = [100, 1_000, 10_000] as const;
const LARGE_CARD_COUNT = 10_000;
const SCROLL_FRAMES = 300;
const VIEWPORT_ROWS = 5;
const GUARD_ROWS = 4;
const MOUNTED_ROWS = VIEWPORT_ROWS + GUARD_ROWS;
const COLUMNS = 3;
const INITIAL_MOUNTED_ROW_START = 10;
const LEADING_GUARD_ROWS = GUARD_ROWS / 2;
const VIEWPORT_HEIGHT = 600;
const MOUNTED_OVERSCAN_PX = 264;
const SAME_ROW_WINDOW_SCROLL_TOP = 1_320;

const createBatchedMaterialization = (
	maxSectionCount: number,
	maxCellCount: number,
	backgroundCellCount = 200,
): TwoHopViewPlanMaterialization => ({
	kind: "batched",
	initial: {
		maxSectionCount,
		maxCellCount,
	},
	background: {
		maxCellCountPerSlice: backgroundCellCount,
	},
});

const layout = {
	containerWidth: 640,
	columns: COLUMNS,
	cellWidth: 200,
	rowHeight: 120,
	gap: 12,
	sectionMarginBottom: 20,
};

const createItem = (key: string): TwoHopVirtualListItem => ({
	kind: "new-link",
	item: { type: "link" } as unknown as TwoHopVirtualListItem["item"],
	searchKey: key,
	virtualKey: key,
});

const createDescriptor = (
	itemCount: number,
	sectionId = "new-links",
	getItems = vi.fn(() =>
		Array.from({ length: itemCount }, (_, index) =>
			createItem(`${sectionId}-item-${index}`),
		),
	),
): SectionRenderDescriptor<TwoHopVirtualListItem, TwoHopVirtualListSection> => {
	const items = getItems();
	const section = {
		kind: "new-links-section",
		rawSectionId: sectionId,
		sectionId,
		sectionKey: sectionId,
		title: "New links",
		getKey: () => "",
	} satisfies TwoHopVirtualListSection;

	return {
		section,
		sectionKey: section.sectionKey,
		title: section.title,
		sectionId: section.sectionId,
		totalCount: itemCount,
		loadedCount: itemCount,
		getItems,
		getItem: (index) => items[index],
		headerProps: {},
	};
};

const compilePlan = (
	sections: readonly SectionRenderDescriptor<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[],
	options?: { batched?: boolean },
) =>
	compileTwoHopViewPlan({
		sections,
		sectionVisibleCounts: Object.fromEntries(
			sections.map((section) => [section.sectionId, section.loadedCount]),
		),
		layout,
		materialization: options?.batched
			? createBatchedMaterialization(10, 200)
			: { kind: "eager" },
		resolveInitialSectionVisibleCount: (section) => section.loadedCount,
		clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
	});

type TwoHopVirtualListComputation = VirtualListComputation<
	VirtualListLogicalCell<TwoHopVirtualListItem>,
	MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
	TwoHopMountedRowsBuild
>;

const createRanges = (mountedStart: number) => ({
	mounted: {
		start: mountedStart,
		end: mountedStart + MOUNTED_ROWS,
	},
	previewVisible: {
		start: mountedStart + LEADING_GUARD_ROWS,
		end: mountedStart + LEADING_GUARD_ROWS + VIEWPORT_ROWS,
	},
});

const buildMountedRows = (
	rowModel: TwoHopViewPlanRowModel,
	mountedStart: number,
	previousBuild?: TwoHopMountedRowsBuild,
): TwoHopMountedRowsBuild => {
	const ranges = createRanges(mountedStart);
	return buildTwoHopMountedRows({
		rowModel,
		rowRange: ranges.mounted,
		ranges,
		previousBuild,
	});
};

const getMountedRowSlotCount = (build: TwoHopMountedRowsBuild): number =>
	new Set(build.rowSlices.map((row) => row.slotKey)).size;

const getAllocatedRowSlotCount = (build: TwoHopMountedRowsBuild): number =>
	build.nextRenderSlotIndex / COLUMNS;

const getRangeLength = (range: { start: number; end: number }): number =>
	range.end - range.start;

const applyPixelScrollMeasurement = (params: {
	rowModel: TwoHopViewPlanRowModel;
	scrollTop: number;
	previous?: TwoHopVirtualListComputation;
	buildMountedCells: typeof buildTwoHopMountedRows;
}): TwoHopVirtualListComputation =>
	computeVirtualListSnapshotWithState<
		VirtualListLogicalCell<TwoHopVirtualListItem>,
		MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
		TwoHopMountedRowsBuild
	>({
		rowModel: params.rowModel,
		measurement: {
			scrollTop: params.scrollTop,
			viewportHeight: VIEWPORT_HEIGHT,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: params.previous !== undefined,
			currentMountedRange: params.previous?.snapshot.ranges.mounted ?? {
				start: 0,
				end: 0,
			},
		},
		visibilityPolicy: {
			bootstrapRows: 3,
			mountedOverscanPx: MOUNTED_OVERSCAN_PX,
		},
		visibilityMetadataPolicy: { type: "caller-managed" },
		previous: params.previous?.snapshot,
		previousState: params.previous?.reconciliationState,
		buildMountedCells: params.buildMountedCells,
	});

describe("TwoHop view-plan performance contracts", () => {
	it("bounds mounted cells by the row window across 300 scroll frames", () => {
		const measurements = CARD_COUNTS.map((cardCount) => {
			const rowModel = createTwoHopViewPlanRowModel(
				compilePlan([createDescriptor(cardCount)]),
			);
			let mounted = buildMountedRows(rowModel, 1);
			let maxMountedRows = mounted.rowSlices.length;
			let maxMountedCells = mounted.cells.length;
			let maxAllocatedRowSlots = getAllocatedRowSlotCount(mounted);

			for (let frame = 1; frame <= SCROLL_FRAMES; frame += 1) {
				const start = 1 + frame;
				mounted = buildMountedRows(rowModel, start, mounted);
				maxMountedRows = Math.max(maxMountedRows, mounted.rowSlices.length);
				maxMountedCells = Math.max(maxMountedCells, mounted.cells.length);
				maxAllocatedRowSlots = Math.max(
					maxAllocatedRowSlots,
					getAllocatedRowSlotCount(mounted),
				);
			}

			return {
				cardCount,
				scrollFrames: SCROLL_FRAMES,
				maxMountedRows,
				maxMountedCells,
				maxAllocatedRowSlots,
			};
		});

		// The TwoHop builder recycles nine physical row slots. Logical list
		// growth and sustained scrolling must not expand that pool.
		expect(measurements).toEqual(
			CARD_COUNTS.map((cardCount) => ({
				cardCount,
				scrollFrames: SCROLL_FRAMES,
				maxMountedRows: MOUNTED_ROWS,
				maxMountedCells: MOUNTED_ROWS * COLUMNS,
				maxAllocatedRowSlots: MOUNTED_ROWS,
			})),
		);
	});

	it("bounds 10,000-card mounted row slots by viewport rows plus guard rows", () => {
		const rowModel = createTwoHopViewPlanRowModel(
			compilePlan([createDescriptor(LARGE_CARD_COUNT)]),
		);
		const measurement = applyPixelScrollMeasurement({
			rowModel,
			scrollTop: SAME_ROW_WINDOW_SCROLL_TOP,
			buildMountedCells: buildTwoHopMountedRows,
		});
		const mounted = measurement.reconciliationState.mountedBuild;
		if (!mounted) throw new Error("Expected mounted TwoHop rows.");

		expect(getRangeLength(measurement.snapshot.ranges.previewVisible)).toBe(
			VIEWPORT_ROWS,
		);
		expect(getRangeLength(measurement.snapshot.ranges.mounted)).toBe(
			VIEWPORT_ROWS + GUARD_ROWS,
		);
		expect(mounted.rowSlices).toHaveLength(MOUNTED_ROWS);
		expect(getMountedRowSlotCount(mounted)).toBe(mounted.rowSlices.length);
		expect(getMountedRowSlotCount(mounted)).toBeLessThanOrEqual(
			VIEWPORT_ROWS + GUARD_ROWS,
		);
	});

	it("does not grow the allocated row slot pool across 300 scroll frames", () => {
		const rowModel = createTwoHopViewPlanRowModel(
			compilePlan([createDescriptor(LARGE_CARD_COUNT)]),
		);
		let mounted = buildMountedRows(rowModel, INITIAL_MOUNTED_ROW_START);
		const allocatedRowSlotCounts = [getAllocatedRowSlotCount(mounted)];

		for (let frame = 1; frame <= SCROLL_FRAMES; frame += 1) {
			mounted = buildMountedRows(
				rowModel,
				INITIAL_MOUNTED_ROW_START + frame,
				mounted,
			);
			allocatedRowSlotCounts.push(getAllocatedRowSlotCount(mounted));
		}

		expect(new Set(allocatedRowSlotCounts)).toEqual(new Set([MOUNTED_ROWS]));
	});

	it("keeps cell render slot keys bounded across 300 scroll frames", () => {
		const rowModel = createTwoHopViewPlanRowModel(
			compilePlan([createDescriptor(LARGE_CARD_COUNT)]),
		);
		let mounted = buildMountedRows(rowModel, INITIAL_MOUNTED_ROW_START);
		const renderSlotKeyLimit = MOUNTED_ROWS * COLUMNS;
		let minRenderSlotKey = Number.POSITIVE_INFINITY;
		let maxRenderSlotKey = -1;
		let allRenderSlotKeysWithinAllocatedPool = true;

		for (let frame = 0; frame <= SCROLL_FRAMES; frame += 1) {
			for (const cell of mounted.cells) {
				minRenderSlotKey = Math.min(minRenderSlotKey, cell.renderSlotKey);
				maxRenderSlotKey = Math.max(maxRenderSlotKey, cell.renderSlotKey);
				allRenderSlotKeysWithinAllocatedPool &&=
					cell.renderSlotKey < mounted.nextRenderSlotIndex;
			}
			if (frame === SCROLL_FRAMES) break;
			mounted = buildMountedRows(
				rowModel,
				INITIAL_MOUNTED_ROW_START + frame + 1,
				mounted,
			);
		}

		expect(minRenderSlotKey).toBe(0);
		expect(maxRenderSlotKey).toBe(renderSlotKeyLimit - 1);
		expect(allRenderSlotKeysWithinAllocatedPool).toBe(true);
	});

	it("preserves mounted cell identity for pixel scrolls inside the same row window", () => {
		const rowModel = createTwoHopViewPlanRowModel(
			compilePlan([createDescriptor(LARGE_CARD_COUNT)]),
		);
		const buildMountedCells = vi.fn(buildTwoHopMountedRows);
		const initial = applyPixelScrollMeasurement({
			rowModel,
			scrollTop: SAME_ROW_WINDOW_SCROLL_TOP,
			buildMountedCells,
		});
		const pixelScrolled = applyPixelScrollMeasurement({
			rowModel,
			scrollTop: SAME_ROW_WINDOW_SCROLL_TOP + 1,
			previous: initial,
			buildMountedCells,
		});

		expect(getRangeLength(initial.snapshot.ranges.previewVisible)).toBe(
			VIEWPORT_ROWS,
		);
		expect(getRangeLength(initial.snapshot.ranges.mounted)).toBe(MOUNTED_ROWS);
		expect(pixelScrolled.snapshot.ranges).toEqual(initial.snapshot.ranges);
		expect(pixelScrolled.snapshot.mountedCells).toBe(initial.snapshot.mountedCells);
		expect(pixelScrolled.reconciliationState.mountedBuild).toBe(
			initial.reconciliationState.mountedBuild,
		);
		expect(buildMountedCells).toHaveBeenCalledTimes(1);
	});

	it("materializes only the first batch for 32 sections", () => {
		const getItemsBySection = Array.from({ length: 32 }, (_, index) =>
			vi.fn(() => [createItem(`item-${index}`)]),
		);
		const sections = getItemsBySection.map((getItems, index) =>
			createDescriptor(1, `section-${index}`, getItems),
		);
		for (const getItems of getItemsBySection) {
			getItems.mockClear();
		}

		const plan = compilePlan(sections, { batched: true });

		expect(plan.cellStore.materializedSectionByIndex).toEqual([
			...new Array<boolean>(10).fill(true),
			...new Array<boolean>(22).fill(false),
		]);
		expect(getItemsBySection.map((getItems) => getItems.mock.calls.length)).toEqual(
			new Array<number>(32).fill(0),
		);
	});

	it("caps an oversized initial section by the initial cell budget", () => {
		const plan = compileTwoHopViewPlan({
			sections: [createDescriptor(LARGE_CARD_COUNT)],
			sectionVisibleCounts: { "new-links": LARGE_CARD_COUNT },
			layout,
			materialization: createBatchedMaterialization(10, 200),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
		});

		expect(plan.cellStore.materializationStateBySectionIndex[0]).toEqual({
			nextCellIndex: 200,
			materializedCellCount: 200,
		});
		expect(plan.cellStore.materializedSectionByIndex[0]).toBe(false);
	});

	it("materializes only the jumped-to mounted window during scrolling", () => {
		const getItem = vi.fn((index: number) =>
			index < LARGE_CARD_COUNT ? createItem(`lazy-item-${index}`) : undefined,
		);
		const section = {
			kind: "new-links-section",
			rawSectionId: "new-links",
			sectionId: "new-links",
			sectionKey: "new-links",
			title: "New links",
			getKey: () => "",
		} satisfies TwoHopVirtualListSection;
		const descriptor: SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		> = {
			section,
			sectionKey: section.sectionKey,
			title: section.title,
			sectionId: section.sectionId,
			totalCount: LARGE_CARD_COUNT,
			loadedCount: LARGE_CARD_COUNT,
			getItems: () => {
				throw new Error("Scrolling must use sparse item access.");
			},
			getItem,
			headerProps: {},
		};
		const plan = compileTwoHopViewPlan({
			sections: [descriptor],
			sectionVisibleCounts: { "new-links": LARGE_CARD_COUNT },
			layout,
			materialization: createBatchedMaterialization(0, 0),
			resolveInitialSectionVisibleCount: (current) => current.loadedCount,
			clampVisibleCount: (current, count) => Math.min(current.loadedCount, count),
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);

		const mounted = buildMountedRows(rowModel, INITIAL_MOUNTED_ROW_START + 1_000);

		expect(mounted.rowSlices).toHaveLength(MOUNTED_ROWS);
		expect(getItem).toHaveBeenCalledTimes(MOUNTED_ROWS * COLUMNS);
		expect(plan.cellStore.revision).toBeGreaterThan(0);
	});
});
