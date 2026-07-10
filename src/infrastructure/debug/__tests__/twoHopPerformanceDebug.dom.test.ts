import { afterEach, describe, expect, it, vi } from "vitest";
import type { CCLDevMeasurementSnapshot } from "../CCLDevMeasurements";
import { createTwoHopPerformanceDebugApi } from "../twoHopPerformanceDebug";

const EMPTY_SNAPSHOT: CCLDevMeasurementSnapshot = {
	enabled: true,
	counters: {
		"virtualScroll.applyScrollMeasurement": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowWindow.apply": { count: 0, lastUpdatedAt: null },
		"twoHop.rowWindow.apply.changed": { count: 0, lastUpdatedAt: null },
		"twoHop.rowWindow.apply.changed.firstBuild": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowWindow.apply.changed.plan": { count: 0, lastUpdatedAt: null },
		"twoHop.rowWindow.apply.changed.rowRange": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowWindow.apply.changed.cellStoreRevision": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowWindow.apply.skipped": { count: 0, lastUpdatedAt: null },
		"twoHop.buildMountedRows": { count: 0, lastUpdatedAt: null },
		"twoHop.rowModelCache.hit": { count: 0, lastUpdatedAt: null },
		"twoHop.rowModelCache.miss": { count: 0, lastUpdatedAt: null },
		"twoHop.rowModelCache.miss.firstResolve": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowModelCache.miss.sections": { count: 0, lastUpdatedAt: null },
		"twoHop.rowModelCache.miss.visibleCounts": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowModelCache.miss.visibleCountsSemanticallySame": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.rowModelCache.miss.layout": { count: 0, lastUpdatedAt: null },
		"twoHop.rowModelCache.miss.layoutSemanticallySame": {
			count: 0,
			lastUpdatedAt: null,
		},
		"twoHop.fixedSlotPool.syncFromBuild": { count: 0, lastUpdatedAt: null },
		"twoHop.TwoHopFixedCellSlot.update": { count: 0, lastUpdatedAt: null },
		"component.TwoHopVirtualItemCard.reevaluate": {
			count: 0,
			lastUpdatedAt: null,
		},
		"component.ViewItemCard.reevaluate": { count: 0, lastUpdatedAt: null },
		"component.CardPreviewGate.reevaluate": { count: 0, lastUpdatedAt: null },
	},
};

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("twoHopPerformanceDebug", () => {
	it("reports mounted Shadow DOM stats for the virtual list", () => {
		const { root, row } = createTwoHopListDom();
		mockElementHeight(row, 40);

		const api = createTwoHopPerformanceDebugApi({
			getMeasurementSnapshot: () => EMPTY_SNAPSHOT,
			resetMeasurements: () => {},
		});

		expect(api.getDomStats({ root })).toMatchObject({
			rootFound: true,
			shadowRootFound: true,
			scrollContainerFound: true,
			totalCards: 100,
			loadedCards: 90,
			sectionCount: 2,
			scrollHeight: 2_000,
			clientHeight: 120,
			maxScrollTop: 1_880,
			rows: 1,
			cells: 2,
			cards: 2,
			contentHeight: 320,
			viewportRows: 3,
			mountedRows: 1,
		});
	});

	it("toggles the paint containment probe inside the list shadow root", () => {
		const { root } = createTwoHopListDom();
		const api = createTwoHopPerformanceDebugApi({
			getMeasurementSnapshot: () => EMPTY_SNAPSHOT,
			resetMeasurements: () => {},
		});

		expect(api.setPaintContainmentProbe(true, { root })).toEqual({
			enabled: true,
			installed: true,
		});
		expect(
			root.shadowRoot?.querySelector("[data-two-hop-paint-test='true']"),
		).not.toBeNull();

		expect(api.setPaintContainmentProbe(false, { root })).toEqual({
			enabled: false,
			installed: false,
		});
		expect(
			root.shadowRoot?.querySelector("[data-two-hop-paint-test='true']"),
		).toBeNull();
	});

	it("runs a deterministic scroll workload and returns frame summaries", async () => {
		const resetMeasurements = vi.fn();
		const { root, scroller } = createTwoHopListDom();
		setNumericProperty(scroller, "scrollHeight", 1_000);
		setNumericProperty(scroller, "clientHeight", 100);
		scroller.scrollTop = 0;
		const api = createTwoHopPerformanceDebugApi({
			getMeasurementSnapshot: () => ({
				...EMPTY_SNAPSHOT,
				counters: {
					...EMPTY_SNAPSHOT.counters,
					"virtualScroll.applyScrollMeasurement": {
						count: 2,
						lastUpdatedAt: null,
					},
				},
			}),
			resetMeasurements,
		});

		const run = await api.runScroll({
			root,
			frames: 2,
			distance: 100,
			log: false,
		});

		expect(resetMeasurements).toHaveBeenCalledTimes(1);
		expect(run.result).toMatchObject({
			frames: 2,
			distancePx: 100,
			actualDistancePx: 100,
			startScrollTop: 0,
			endScrollTop: 100,
		});
		expect(run.frameDurations).toHaveLength(2);
		expect(scroller.scrollTop).toBe(100);
		expect(run.counters).toContainEqual({
			name: "virtualScroll.applyScrollMeasurement",
			count: 2,
		});
	});

	it("skips overflow ancestors that cannot actually scroll", async () => {
		const { root, scroller } = createTwoHopListDom();
		const wrapper = document.createElement("div");
		wrapper.style.overflowY = "auto";
		setNumericProperty(wrapper, "scrollHeight", 100);
		setNumericProperty(wrapper, "clientHeight", 100);
		scroller.replaceChildren(wrapper);
		wrapper.append(root);
		setNumericProperty(scroller, "scrollHeight", 1_000);
		setNumericProperty(scroller, "clientHeight", 100);
		scroller.scrollTop = 0;
		const api = createTwoHopPerformanceDebugApi({
			getMeasurementSnapshot: () => EMPTY_SNAPSHOT,
			resetMeasurements: () => {},
		});

		const run = await api.runScroll({
			root,
			frames: 1,
			distance: 80,
			log: false,
		});

		expect(run.result.actualDistancePx).toBe(80);
		expect(scroller.scrollTop).toBe(80);
		expect(wrapper.scrollTop).toBe(0);
	});
});

function createTwoHopListDom(): {
	root: HTMLElement;
	scroller: HTMLElement;
	row: HTMLElement;
} {
	const scroller = document.createElement("div");
	scroller.style.overflowY = "auto";
	setNumericProperty(scroller, "clientHeight", 120);
	setNumericProperty(scroller, "scrollHeight", 2_000);

	const root = document.createElement("div");
	root.className = "twohop-page-virtual-list";
	root.dataset.twoHopTotalCardCount = "100";
	root.dataset.twoHopLoadedCardCount = "90";
	root.dataset.twoHopSectionCount = "2";
	const shadowRoot = root.attachShadow({ mode: "open" });
	const content = document.createElement("div");
	content.className = "view-plan-virtual-list-content";
	mockElementHeight(content, 320);

	const row = document.createElement("div");
	row.className = "view-plan-flow-row";
	for (let index = 0; index < 2; index += 1) {
		const cell = document.createElement("div");
		cell.className = "view-plan-virtual-list-cell";
		const card = document.createElement("div");
		card.className = "cosense-card-links__box";
		cell.append(card);
		row.append(cell);
	}

	content.append(row);
	shadowRoot.append(content);
	scroller.append(root);
	document.body.append(scroller);

	return { root, scroller, row };
}

function setNumericProperty(
	element: HTMLElement,
	property: "clientHeight" | "scrollHeight",
	value: number,
): void {
	Object.defineProperty(element, property, {
		configurable: true,
		value,
	});
}

function mockElementHeight(element: HTMLElement, height: number): void {
	element.getBoundingClientRect = () =>
		({
			x: 0,
			y: 0,
			top: 0,
			right: 0,
			bottom: height,
			left: 0,
			width: 0,
			height,
			toJSON: () => ({}),
		}) satisfies DOMRect;
}
