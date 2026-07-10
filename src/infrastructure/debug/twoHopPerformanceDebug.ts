import {
	CCL_DEV_MEASUREMENT_NAMES,
	type CCLDevMeasurementName,
	type CCLDevMeasurementSnapshot,
} from "./CCLDevMeasurements";

const DEFAULT_TWO_HOP_COUNTER_NAMES = [
	"virtualScroll.applyScrollMeasurement",
	"twoHop.rowWindow.apply",
	"twoHop.rowWindow.apply.changed",
	"twoHop.rowWindow.apply.skipped",
	"twoHop.buildMountedRows",
	"twoHop.rowModelCache.hit",
	"twoHop.rowModelCache.miss",
	"twoHop.rowModelCache.miss.sections",
	"twoHop.rowModelCache.miss.visibleCounts",
	"twoHop.rowModelCache.miss.layout",
	"component.TwoHopVirtualItemCard.reevaluate",
	"component.ViewItemCard.reevaluate",
	"component.CardPreviewGate.reevaluate",
] as const satisfies readonly CCLDevMeasurementName[];

const DEFAULT_ROOT_SELECTOR = ".twohop-page-virtual-list";
const PAINT_CONTAINMENT_PROBE_SELECTOR =
	"style[data-two-hop-paint-test='true']";
const PAINT_CONTAINMENT_PROBE_CSS = `
	.view-plan-virtual-list-cell {
		contain: layout paint !important;
	}
`;

export interface TwoHopVirtualListQueryOptions {
	readonly root?: HTMLElement;
	readonly rootSelector?: string;
}

export interface TwoHopVirtualListDomStats {
	readonly rootFound: boolean;
	readonly shadowRootFound: boolean;
	readonly scrollContainerFound: boolean;
	readonly totalCards: number | null;
	readonly loadedCards: number | null;
	readonly sectionCount: number | null;
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
	readonly maxScrollTop: number;
	readonly rows: number;
	readonly cells: number;
	readonly cards: number;
	readonly contentHeight: number;
	readonly viewportRows: number | null;
	readonly mountedRows: number;
}

export interface TwoHopScrollRunOptions extends TwoHopVirtualListQueryOptions {
	readonly frames?: number;
	readonly distance?: number;
	readonly targetFps?: number;
	readonly log?: boolean;
	readonly resetCounters?: boolean;
}

export interface TwoHopScrollSummary {
	readonly frames: number;
	readonly distancePx: number;
	readonly actualDistancePx: number;
	readonly startScrollTop: number;
	readonly endScrollTop: number;
	readonly p50Ms: number;
	readonly p95Ms: number;
	readonly maxMs: number;
	readonly targetFps: number;
	readonly frameBudgetMs: number;
	readonly overFrameBudgetMs: number;
	readonly overDoubleFrameBudgetMs: number;
	readonly over16_7Ms: number;
	readonly over33_3Ms: number;
}

export interface TwoHopScrollRun {
	readonly result: TwoHopScrollSummary;
	readonly frameDurations: readonly number[];
	readonly beforeDomStats: TwoHopVirtualListDomStats;
	readonly afterDomStats: TwoHopVirtualListDomStats;
	readonly counters: readonly TwoHopCounterRow[];
}

export interface TwoHopCounterRow {
	readonly name: CCLDevMeasurementName;
	readonly count: number;
}

export interface TwoHopPaintContainmentProbeResult {
	readonly enabled: boolean;
	readonly installed: boolean;
	readonly reason?: string;
}

export interface TwoHopPerformanceDebugApi {
	readonly defaultCounterNames: readonly CCLDevMeasurementName[];
	getDomStats(options?: TwoHopVirtualListQueryOptions): TwoHopVirtualListDomStats;
	getCounterRows(names?: readonly CCLDevMeasurementName[]): TwoHopCounterRow[];
	runScroll(options?: TwoHopScrollRunOptions): Promise<TwoHopScrollRun>;
	setPaintContainmentProbe(
		enabled: boolean,
		options?: TwoHopVirtualListQueryOptions,
	): TwoHopPaintContainmentProbeResult;
}

interface TwoHopPerformanceDebugDependencies {
	getMeasurementSnapshot(): CCLDevMeasurementSnapshot;
	resetMeasurements(): void;
}

export function createTwoHopPerformanceDebugApi(
	dependencies: TwoHopPerformanceDebugDependencies,
): TwoHopPerformanceDebugApi {
	return {
		defaultCounterNames: DEFAULT_TWO_HOP_COUNTER_NAMES,
		getDomStats(options = {}) {
			return getTwoHopVirtualListDomStats(options);
		},
		getCounterRows(names = DEFAULT_TWO_HOP_COUNTER_NAMES) {
			return getTwoHopCounterRows(dependencies.getMeasurementSnapshot(), names);
		},
		async runScroll(options = {}) {
			if (options.resetCounters ?? true) {
				dependencies.resetMeasurements();
			}

			const run = await runTwoHopScrollWorkload(
				options,
				() =>
					getTwoHopCounterRows(
						dependencies.getMeasurementSnapshot(),
						DEFAULT_TWO_HOP_COUNTER_NAMES,
					),
			);

			if (options.log ?? true) {
				console.table(run.result);
				console.table(run.afterDomStats);
				console.table(run.counters);
			}

			return run;
		},
		setPaintContainmentProbe(enabled, options = {}) {
			return setTwoHopPaintContainmentProbe(enabled, options);
		},
	};
}

function getTwoHopVirtualListDomStats(
	options: TwoHopVirtualListQueryOptions,
): TwoHopVirtualListDomStats {
	const root = resolveTwoHopVirtualListRoot(options);
	const shadowRoot = root?.shadowRoot ?? null;
	const rows = shadowRoot?.querySelectorAll(".view-plan-flow-row").length ?? 0;
	const cells =
		shadowRoot?.querySelectorAll(".view-plan-virtual-list-cell").length ?? 0;
	const cards =
		shadowRoot?.querySelectorAll(".cosense-card-links__box").length ?? 0;
	const contentHeight =
		shadowRoot
			?.querySelector(".view-plan-virtual-list-content")
			?.getBoundingClientRect().height ?? 0;
	const firstRowHeight =
		shadowRoot
			?.querySelector(".view-plan-flow-row")
			?.getBoundingClientRect().height ?? 0;
	const scroller = root ? findNearestScrollableAncestor(root) : null;
	const scrollHeight = scroller?.scrollHeight ?? 0;
	const clientHeight = scroller?.clientHeight ?? 0;
	const viewportRows =
		scroller && firstRowHeight > 0
			? Math.ceil(clientHeight / firstRowHeight)
			: null;

	return {
		rootFound: root !== null,
		shadowRootFound: shadowRoot !== null,
		scrollContainerFound: scroller !== null,
		totalCards: parseDatasetInteger(root?.dataset.twoHopTotalCardCount),
		loadedCards: parseDatasetInteger(root?.dataset.twoHopLoadedCardCount),
		sectionCount: parseDatasetInteger(root?.dataset.twoHopSectionCount),
		scrollTop: scroller?.scrollTop ?? 0,
		scrollHeight,
		clientHeight,
		maxScrollTop: Math.max(0, scrollHeight - clientHeight),
		rows,
		cells,
		cards,
		contentHeight,
		viewportRows,
		mountedRows: rows,
	};
}

function getTwoHopCounterRows(
	snapshot: CCLDevMeasurementSnapshot,
	names: readonly CCLDevMeasurementName[],
): TwoHopCounterRow[] {
	const validNames = new Set<CCLDevMeasurementName>(CCL_DEV_MEASUREMENT_NAMES);

	return names
		.filter((name): name is CCLDevMeasurementName => validNames.has(name))
		.map((name) => ({
			name,
			count: snapshot.counters[name]?.count ?? 0,
		}));
}

async function runTwoHopScrollWorkload(
	options: TwoHopScrollRunOptions,
	getCounters: () => readonly TwoHopCounterRow[],
): Promise<TwoHopScrollRun> {
	const root = resolveTwoHopVirtualListRoot(options);
	if (!root) {
		throw new Error("TwoHop virtual list not found");
	}

	const scroller = findNearestScrollableAncestor(root);
	if (!scroller) {
		throw new Error("Scrollable container not found");
	}

	const frames = normalizePositiveInteger(options.frames, 300);
	const distance = normalizeNonNegativeNumber(options.distance, 4_000);
	const targetFps = normalizePositiveNumber(options.targetFps, 60);
	const beforeDomStats = getTwoHopVirtualListDomStats({ root });
	const originalBehavior = scroller.style.scrollBehavior;
	scroller.style.scrollBehavior = "auto";

	const start = scroller.scrollTop;
	const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
	const end = Math.min(maxScroll, start + distance);
	const frameDurations: number[] = [];
	let previous = performance.now();

	try {
		for (let index = 1; index <= frames; index += 1) {
			scroller.scrollTop = start + ((end - start) * index) / frames;
			await nextAnimationFrame();

			const now = performance.now();
			frameDurations.push(now - previous);
			previous = now;
		}
	} finally {
		scroller.style.scrollBehavior = originalBehavior;
	}

	const result = summarizeScrollRun({
		frames,
		distance,
		targetFps,
		start,
		end,
		frameDurations,
	});

	return {
		result,
		frameDurations,
		beforeDomStats,
		afterDomStats: getTwoHopVirtualListDomStats({ root }),
		counters: getCounters(),
	};
}

function summarizeScrollRun(input: {
	readonly frames: number;
	readonly distance: number;
	readonly targetFps: number;
	readonly start: number;
	readonly end: number;
	readonly frameDurations: readonly number[];
}): TwoHopScrollSummary {
	const sorted = [...input.frameDurations].sort((a, b) => a - b);
	const frameBudget = 1_000 / input.targetFps;
	const doubleFrameBudget = frameBudget * 2;

	return {
		frames: input.frames,
		distancePx: roundToTwoDecimals(input.distance),
		actualDistancePx: roundToTwoDecimals(input.end - input.start),
		startScrollTop: roundToTwoDecimals(input.start),
		endScrollTop: roundToTwoDecimals(input.end),
		p50Ms: roundToTwoDecimals(percentile(sorted, 0.5)),
		p95Ms: roundToTwoDecimals(percentile(sorted, 0.95)),
		maxMs: roundToTwoDecimals(Math.max(...input.frameDurations)),
		targetFps: roundToTwoDecimals(input.targetFps),
		frameBudgetMs: roundToTwoDecimals(frameBudget),
		overFrameBudgetMs: input.frameDurations.filter(
			(value) => value > frameBudget,
		).length,
		overDoubleFrameBudgetMs: input.frameDurations.filter(
			(value) => value > doubleFrameBudget,
		).length,
		over16_7Ms: input.frameDurations.filter((value) => value > 16.7).length,
		over33_3Ms: input.frameDurations.filter((value) => value > 33.3).length,
	};
}

function setTwoHopPaintContainmentProbe(
	enabled: boolean,
	options: TwoHopVirtualListQueryOptions,
): TwoHopPaintContainmentProbeResult {
	const root = resolveTwoHopVirtualListRoot(options);
	const shadowRoot = root?.shadowRoot ?? null;
	if (!root || !shadowRoot) {
		return {
			enabled,
			installed: false,
			reason: !root ? "root-not-found" : "shadow-root-not-found",
		};
	}

	shadowRoot.querySelector(PAINT_CONTAINMENT_PROBE_SELECTOR)?.remove();
	if (!enabled) {
		return { enabled: false, installed: false };
	}

	const style = document.createElement("style");
	style.dataset.twoHopPaintTest = "true";
	style.textContent = PAINT_CONTAINMENT_PROBE_CSS;
	shadowRoot.append(style);

	return { enabled: true, installed: true };
}

function resolveTwoHopVirtualListRoot(
	options: TwoHopVirtualListQueryOptions,
): HTMLElement | null {
	if (options.root) return options.root;

	const selector = options.rootSelector ?? DEFAULT_ROOT_SELECTOR;
	const roots = Array.from(document.querySelectorAll<HTMLElement>(selector));
	return (
		roots.find((root) => {
			if (!root.isConnected || !root.shadowRoot) return false;
			return (
				root.shadowRoot.querySelector(".view-plan-virtual-list-cell") !== null
			);
		}) ??
		roots.find((root) => root.isConnected && root.shadowRoot) ??
		roots.find((root) => root.isConnected) ??
		null
	);
}

function findNearestScrollableAncestor(root: HTMLElement): HTMLElement | null {
	let scroller = root.parentElement;

	while (scroller) {
		if (isScrollableElement(scroller)) {
			return scroller;
		}
		scroller = scroller.parentElement;
	}

	const documentScroller = document.scrollingElement;
	return documentScroller instanceof HTMLElement &&
		isScrollableElement(documentScroller)
		? documentScroller
		: null;
}

function isScrollableElement(element: HTMLElement): boolean {
	if (!/(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY)) {
		return false;
	}

	return element.scrollHeight > element.clientHeight;
}

function normalizePositiveInteger(
	value: number | undefined,
	fallback: number,
): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeNumber(
	value: number | undefined,
	fallback: number,
): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(0, value);
}

function normalizePositiveNumber(
	value: number | undefined,
	fallback: number,
): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return value > 0 ? value : fallback;
}

function parseDatasetInteger(value: string | undefined): number | null {
	if (value === undefined) return null;

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) return null;

	return parsed;
}

function percentile(sortedValues: readonly number[], ratio: number): number {
	const index = Math.min(
		sortedValues.length - 1,
		Math.floor((sortedValues.length - 1) * ratio),
	);
	return sortedValues[index] ?? 0;
}

function roundToTwoDecimals(value: number): number {
	return Number(value.toFixed(2));
}

function nextAnimationFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			resolve();
		});
	});
}
