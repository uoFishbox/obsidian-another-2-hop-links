import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StableScrollTopBand } from "ui/virtualization/engine/scrollWindowResolver";
import type { VirtualVisibilityPolicy } from "ui/virtualization/model/ranges";
import type {
	ObserveVirtualViewportOptions,
	ScrollMeasurementRange,
} from "ui/virtualization/viewport/observer/scrollerRegistry";
import type { MutableRowRange, RowRange } from "ui/virtualization/model/ranges";
import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import {
	logicalCellKey,
	type MountedVirtualCell,
	type VirtualRanges,
	type VirtualRowModel,
} from "ui/virtualization/model/types";
import {
	useVirtualizer,
	type UseVirtualizerOptions,
} from "ui/virtualization/runtime/useVirtualizer.svelte";
import UseVirtualizerHarness from "./UseVirtualizerHarness.svelte";

const viewportObservationHarness = vi.hoisted(() => ({
	options: undefined as unknown,
	publishScrollMeasurementRange:
		vi.fn<(range: ScrollMeasurementRange | null) => void>(),
}));

vi.mock(
	"ui/virtualization/viewport/observer/scrollerRegistry",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("ui/virtualization/viewport/observer/scrollerRegistry")
			>();
		return {
			...actual,
			observeVirtualViewport: (options: ObserveVirtualViewportOptions) => {
				viewportObservationHarness.options = options;
				return Object.assign(
					vi.fn<() => void>(() => {}),
					{
						publishScrollMeasurementRange:
							viewportObservationHarness.publishScrollMeasurementRange,
					},
				) as ReturnType<typeof actual.observeVirtualViewport>;
			},
		};
	},
);

const VISIBILITY_POLICY: VirtualVisibilityPolicy = {
	bootstrapRows: 1,
	mountedOverscanPx: 0,
	previewOverscanPx: 0,
};

interface TestRowModelState {
	rowCount?: number;
	totalHeight?: number;
	mounted: RowRange;
	previewVisible: RowRange;
	mountedCoverageBand?: StableScrollTopBand;
	previewCoverageBand?: StableScrollTopBand;
}

interface TestCell {
	readonly id: string;
}

type TestMountedCell = MountedVirtualCell;
type TestMountedBuild = { cells: TestMountedCell[] };

type TestRowModel = VirtualRowModel<TestCell> & {
	findMountedCoverageScrollTopBandInto(
		out: { min: number; max: number },
		params: { mounted: RowRange },
	): void;
};

const copyRange = (out: MutableRowRange, range: RowRange): void => {
	out.start = range.start;
	out.end = range.end;
};

const createTestRowModel = (state: TestRowModelState): TestRowModel => {
	const revision = { content: state, layout: state };
	return {
		revision,
		get rowCount() {
			return state.rowCount ?? 100;
		},
		get totalHeight() {
			return state.totalHeight ?? 1_000;
		},
		layout: {
			containerWidth: 100,
			columns: 1,
			cellWidth: 100,
			gap: 0,
			rowHeight: 10,
			contentHeight: state.totalHeight ?? 1_000,
		},
		getRow: () => null,
		findVisibleRangeInto(out) {
			copyRange(out, state.mounted);
		},
		findVisibleRangesInto(out, { mounted }) {
			copyRange(out.mounted, mounted ?? state.mounted);
			copyRange(out.previewVisible, state.previewVisible);
		},
		findMountedCoverageScrollTopBandInto(out, { mounted }) {
			const isPreviewRange =
				mounted.start === state.previewVisible.start &&
				mounted.end === state.previewVisible.end;
			const band = isPreviewRange
				? state.previewCoverageBand
				: state.mountedCoverageBand;
			out.min = band?.min ?? Number.POSITIVE_INFINITY;
			out.max = band?.max ?? Number.NEGATIVE_INFINITY;
		},
	};
};

const createTestFrameCoordinator = (): VirtualFrameCoordinator => {
	const handles = new Map<string, number>();
	const taskKey = (lane: string, key: string): string => `${lane}:${key}`;
	return {
		schedule(lane, key, task): boolean {
			const resolvedKey = taskKey(lane, key);
			if (handles.has(resolvedKey)) return false;
			const handle = window.setTimeout(() => {
				handles.delete(resolvedKey);
				task();
			}, 0);
			handles.set(resolvedKey, handle);
			return true;
		},
		cancel(lane, key): void {
			const resolvedKey = taskKey(lane, key);
			const handle = handles.get(resolvedKey);
			if (handle !== undefined) window.clearTimeout(handle);
			handles.delete(resolvedKey);
		},
		isScheduled: (lane, key) => handles.has(taskKey(lane, key)),
		dispose(): void {
			for (const handle of handles.values()) window.clearTimeout(handle);
			handles.clear();
		},
	};
};

const createRoot = (rectOverrides: Partial<DOMRect> = {}): HTMLElement => {
	const rootEl = document.createElement("div");
	rootEl.getBoundingClientRect = () =>
		({
			top: 10,
			left: 0,
			right: 320,
			bottom: 410,
			width: 320,
			height: 400,
			x: 0,
			y: 10,
			toJSON: () => ({}),
			...rectOverrides,
		}) as DOMRect;
	return rootEl;
};

type TestRuntime = ReturnType<
	typeof useVirtualizer<
		TestCell,
		TestRowModel,
		TestRowModel,
		TestMountedCell,
		TestMountedBuild
	>
>;

const activeFrameCoordinators = new Set<VirtualFrameCoordinator>();

const createRuntimeHarness = (
	state: TestRowModelState = {
		mounted: { start: 0, end: 10 },
		previewVisible: { start: 2, end: 8 },
	},
	overrides: Partial<
		UseVirtualizerOptions<
			TestCell,
			TestRowModel,
			TestRowModel,
			TestMountedCell,
			TestMountedBuild
		>
	> = {},
) => {
	const rootEl = createRoot();
	document.body.append(rootEl);
	const rowModel = createTestRowModel(state);
	const onSnapshotUpdated = vi.fn();
	const findVisibleRangeInto = vi.spyOn(rowModel, "findVisibleRangeInto");
	const findVisibleRangesInto = vi.spyOn(rowModel, "findVisibleRangesInto");
	const options: UseVirtualizerOptions<
		TestCell,
		TestRowModel,
		TestRowModel,
		TestMountedCell,
		TestMountedBuild
	> = {
		getRootEl: () => rootEl,
		getContext: () => rowModel,
		hasRenderableContent: () => true,
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy: () => VISIBILITY_POLICY,
		buildMountedCells: ({ rowRange }) => ({
			cells:
				rowRange.start < rowRange.end
					? [
							{
								key: logicalCellKey(`row-${rowRange.start}`),
								physicalCellSlot: 0,
								rowIndex: rowRange.start,
							},
						]
					: [],
		}),
		onSnapshotUpdated,
		resolveLayoutMeasurement: (nextMeasurement) => ({
			context: rowModel,
			measurement: nextMeasurement,
			isStable: true,
		}),
		frameCoordinator: createTestFrameCoordinator(),
		...overrides,
	};
	activeFrameCoordinators.add(options.frameCoordinator);
	let runtime: TestRuntime | undefined;
	render(UseVirtualizerHarness, {
		initialize: () => {
			runtime = useVirtualizer(options);
		},
	});
	expect(runtime).toBeDefined();
	const initializedRuntime = runtime as TestRuntime;
	initializedRuntime.measurement.sectionTop = 0;
	initializedRuntime.measurement.viewportHeight = 100;
	initializedRuntime.measurement.hasStableScrollMetrics = true;
	return {
		runtime: initializedRuntime,
		rootEl,
		rowModel,
		onSnapshotUpdated,
		findVisibleRangeInto,
		findVisibleRangesInto,
	};
};

const ACTIVE_SCROLL_METRICS = {
	scrollTop: 50,
	viewportHeight: 100,
	frameId: 1,
	isScrollActive: true,
	scrollGeneration: 1,
};

describe("useVirtualizer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		viewportObservationHarness.options = undefined;
		viewportObservationHarness.publishScrollMeasurementRange.mockReset();
	});

	afterEach(() => {
		cleanup();
		for (const frameCoordinator of activeFrameCoordinators) {
			frameCoordinator.dispose();
		}
		activeFrameCoordinators.clear();
		document.body.replaceChildren();
		vi.useRealTimers();
	});

	it("owns live measurement state and publishes a snapshot", () => {
		const { runtime, onSnapshotUpdated } = createRuntimeHarness();
		const scrollTop = window.scrollY || window.pageYOffset || 0;

		const result = runtime.runLayoutMeasurement();

		expect(result.kind).toBe("measured");
		expect(runtime.measurement.sectionTop).toBe(10 + scrollTop);
		expect(runtime.measurement.viewportHeight).toBe(window.innerHeight);
		expect(runtime.measurement.hasStableScrollMetrics).toBe(true);
		expect(onSnapshotUpdated).toHaveBeenCalledOnce();
	});

	it("owns programmatic scroll measurement state and publication", () => {
		const { runtime } = createRuntimeHarness();

		const result = runtime.flushProgrammaticScrollMeasurement({
			scrollContainerEl: null,
			scrollTop: 80,
			viewportHeight: 120,
			sectionTop: 20,
			didScroll: true,
		});

		expect(result.kind).toBe("measured");
		expect(runtime.measurement.viewportHeight).toBe(120);
		expect(runtime.measurement.sectionTop).toBe(20);
		expect(runtime.measurement.hasStableScrollMetrics).toBe(true);
		expect(runtime.getSnapshot()?.ranges).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		});
	});

	it("skips unchanged stable cached scroll geometry", () => {
		const { runtime, findVisibleRangesInto } = createRuntimeHarness();

		expect(runtime.runScrollMeasurement(ACTIVE_SCROLL_METRICS).kind).toBe(
			"measured",
		);
		const callCountAfterFirstMeasurement = findVisibleRangesInto.mock.calls.length;
		const skipped = runtime.runScrollMeasurement({
			...ACTIVE_SCROLL_METRICS,
			frameId: 2,
		});

		expect(skipped).toEqual({
			kind: "skipped",
			reason: "unchanged-scroll",
		});
		expect(findVisibleRangesInto).toHaveBeenCalledTimes(
			callCountAfterFirstMeasurement,
		);
	});

	it("re-runs range resolution when publication is forced", () => {
		const { runtime, findVisibleRangesInto } = createRuntimeHarness();

		runtime.runScrollMeasurement(ACTIVE_SCROLL_METRICS);
		const callCountAfterFirstMeasurement = findVisibleRangesInto.mock.calls.length;
		const result = runtime.runScrollMeasurement(
			{ ...ACTIVE_SCROLL_METRICS, frameId: 2 },
			{ forcePublish: true, reason: "data-change" },
		);

		expect(result.kind).toBe("measured");
		expect(findVisibleRangesInto.mock.calls.length).toBeGreaterThan(
			callCountAfterFirstMeasurement,
		);
	});

	it("resolves stable ranges once and reuses them for engine publication and coverage", () => {
		const { runtime, findVisibleRangeInto, findVisibleRangesInto } =
			createRuntimeHarness();

		runtime.runScrollMeasurement(ACTIVE_SCROLL_METRICS);

		expect(findVisibleRangeInto).toHaveBeenCalledTimes(1);
		expect(findVisibleRangesInto).toHaveBeenCalledTimes(1);
	});

	it("uses one runtime-owned range result on the active-scroll hot path", () => {
		const state: TestRowModelState = {
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		};
		const { runtime } = createRuntimeHarness(state);

		runtime.runScrollMeasurement(ACTIVE_SCROLL_METRICS);
		expect(runtime.getSnapshot()?.ranges).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		});

		state.previewVisible = { start: 3, end: 9 };
		runtime.runScrollMeasurement({
			...ACTIVE_SCROLL_METRICS,
			scrollTop: 70,
			frameId: 2,
		});
		expect(runtime.getSnapshot()?.ranges).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 3, end: 9 },
		});
	});

	it("publishes the mounted/preview coverage intersection directly", () => {
		const { runtime, rootEl } = createRuntimeHarness({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
			mountedCoverageBand: { min: 20, max: 80 },
			previewCoverageBand: { min: 30, max: 70 },
		});
		const cleanup = runtime.observeRoot(rootEl);

		runtime.runScrollMeasurement(ACTIVE_SCROLL_METRICS);

		expect(
			viewportObservationHarness.publishScrollMeasurementRange,
		).toHaveBeenLastCalledWith({
			minScrollTopBeforeMeasurement: 30,
			maxScrollTopBeforeMeasurement: 70,
		});
		cleanup();
	});

	it("suppresses scroll work while layout measurement is pending", async () => {
		const { runtime, onSnapshotUpdated, findVisibleRangesInto } =
			createRuntimeHarness();

		runtime.scheduleLayoutMeasurement();
		runtime.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();

		expect(onSnapshotUpdated).toHaveBeenCalledTimes(1);
		const rangeCallsAfterLayout = findVisibleRangesInto.mock.calls.length;

		runtime.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();
		expect(findVisibleRangesInto.mock.calls.length).toBeGreaterThan(
			rangeCallsAfterLayout,
		);
	});

	it("wires bootstrap suppression and stabilization through one lifecycle", () => {
		const { runtime, rootEl } = createRuntimeHarness();
		const cleanup = runtime.observeRoot(rootEl);
		const observerOptions =
			viewportObservationHarness.options as ObserveVirtualViewportOptions;

		expect(observerOptions.runInitialLayoutMeasurement).toBeTypeOf("function");
		expect(observerOptions.scheduleLayoutMeasurement).toBeTypeOf("function");
		expect(observerOptions.cancelInitialStabilizationMeasurement).toBeTypeOf(
			"function",
		);
		observerOptions.runInitialLayoutMeasurement();
		expect(runtime.getSnapshot()).not.toBeNull();
		cleanup();
	});
});
