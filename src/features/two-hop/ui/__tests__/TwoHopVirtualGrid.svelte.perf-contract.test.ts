import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import { getTwoHopCardCounts } from "infrastructure/debug/twoHopCardCountRegistry";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import {
	flushFrames,
	installAnimationFrameMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownAnimationFrameMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import TwoHopVirtualGridHarness from "./TwoHopVirtualGridHarness.svelte";

const cardDemandProbe = vi.hoisted(() => ({ setDemand: vi.fn() }));

vi.mock(
	"features/two-hop/runtime/virtual-grid/cardHydrator",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("features/two-hop/runtime/virtual-grid/cardHydrator")
			>();
		return {
			...actual,
			createTwoHopCardHydrator: (
				params: Parameters<typeof actual.createTwoHopCardHydrator>[0],
			) => {
				const hydrator = actual.createTwoHopCardHydrator(params);
				return {
					...hydrator,
					setDemand(demand: Parameters<typeof hydrator.setDemand>[0]): void {
						cardDemandProbe.setDemand(demand);
						hydrator.setDemand(demand);
					},
				};
			},
		};
	},
);

function createSection(count: number, totalCount = count): TwoHopSectionModel {
	const items = Array.from({ length: count }, (_, index) => ({
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		key: `item:${index}`,
	})) as TwoHopItemModel[];
	return createTwoHopSectionModel({
		id: "section",
		kind: "new-links-section",
		title: "Section",
		items,
		totalCount,
	});
}

function createCardModelResolver() {
	return vi.fn(
		(item: TwoHopItemModel, _revision: unknown): CardRenderModel => ({
			item: item.item,
			targetFile: null,
			title: item.key,
			ariaLabel: item.key,
			className: null,
			extension: null,
			interactionId: item.key,
			interactionDescriptor: null,
			searchQuery: "",
			previewRequest: null,
		}),
	);
}

interface SurfaceFixture {
	readonly root: HTMLElement;
	readonly scroller: HTMLElement;
	readonly rerender: ReturnType<typeof render>["rerender"];
	readonly publishSection: (
		section: TwoHopSectionModel,
		cardModelRevision?: unknown,
	) => Promise<void>;
}

async function renderSurface(params: {
	section: TwoHopSectionModel;
	resolveItemCardModel: ReturnType<typeof createCardModelResolver>;
	loadMoreSection?: (sectionId: string) => void;
	rootTop?: number;
	cardModelRevision?: unknown;
}): Promise<SurfaceFixture> {
	const applicationStore = {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 100,
			cardHeightRatio: 1,
			cardMaxColumns: 3,
		},
	} as unknown as ApplicationStore;
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientWidth", 320);
	setNumericProperty(scroller, "clientHeight", 300);
	setNumericProperty(scroller, "scrollHeight", 40_000);
	setNumericProperty(scroller, "scrollTop", 0);
	setElementRect(scroller, { top: 0, width: 320, height: 300 });
	document.body.append(scroller);

	const baseProps = {
		sections: [params.section],
		applicationStore,
		linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
		loadMoreSection: params.loadMoreSection,
		resolveItemCardModel: params.resolveItemCardModel,
		cardModelRevision: params.cardModelRevision ?? 0,
	};
	const rendered = render(TwoHopVirtualGridHarness, {
		target: scroller,
		props: baseProps,
	});
	const root = rendered.container.querySelector<HTMLElement>(
		".twohop-virtual-surface",
	);
	if (!root) throw new Error("Two-hop virtual surface was not rendered");
	setElementRect(root, {
		top: params.rootTop ?? 0,
		width: 320,
		height: 40_000,
	});
	triggerResize(root, 320, 40_000);
	for (let index = 0; index < 4; index += 1) await flushFrames();

	return {
		root,
		scroller,
		rerender: rendered.rerender,
		publishSection: (section, cardModelRevision = baseProps.cardModelRevision) =>
			rendered.rerender({
				...baseProps,
				sections: [section],
				cardModelRevision,
			}),
	};
}

function getRows(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.shadowRoot?.querySelectorAll<HTMLElement>(".twohop-virtual-row") ?? [],
	);
}

async function waitForStableRowCount(root: HTMLElement): Promise<number> {
	let previousRowCount = -1;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const rowCount = getRows(root).length;
		if (rowCount === previousRowCount) return rowCount;
		previousRowCount = rowCount;
		await flushFrames();
	}
	return previousRowCount;
}

beforeEach(() => {
	resetRecords();
	resetCCLDevMeasurements();
	cardDemandProbe.setDemand.mockClear();
	installResizeObserverMock();
	installAnimationFrameMock();
	setNumericProperty(window, "scrollY", 0);
});

afterEach(() => {
	cleanup();
	teardownAnimationFrameMock();
	teardownResizeObserverMock();
});

describe("TwoHopVirtualGrid performance contract", () => {
	it("publishes card demand once for one section publication", async () => {
		const resolver = createCardModelResolver();
		const section = createSection(20);
		const { publishSection } = await renderSurface({
			section,
			resolveItemCardModel: resolver,
		});
		cardDemandProbe.setDemand.mockClear();
		resetCCLDevMeasurements();

		const replacement = { ...section.items[0]! };
		await publishSection(
			createTwoHopSectionModel({
				id: section.id,
				kind: section.kind,
				title: section.title,
				items: [replacement, ...section.items.slice(1)],
				totalCount: section.totalCount,
			}),
		);
		const demandAfterRerender = cardDemandProbe.setDemand.mock.calls.length;
		for (let index = 0; index < 4; index += 1) await flushFrames();

		expect(demandAfterRerender).toBe(0);
		expect(cardDemandProbe.setDemand).toHaveBeenCalledTimes(1);
		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["virtualScroll.applyScrollMeasurement.dataChange"].count).toBe(
			1,
		);
		expect(counters["virtualScroll.rangeMeasurementApplied"].count).toBe(1);
		expect(
			counters["virtualList.scheduler.measurementLayout.animationFrame"].count,
		).toBe(0);
	});

	it("rebinds cell bodies in reused physical slots across a long scroll", async () => {
		const resolver = createCardModelResolver();
		const { root, scroller } = await renderSurface({
			section: createSection(10_000),
			resolveItemCardModel: resolver,
		});

		await vi.waitFor(() => expect(getRows(root).length).toBeGreaterThan(0));
		await waitForStableRowCount(root);

		setNumericProperty(scroller, "scrollTop", 20_000);
		await fireEvent.scroll(scroller);
		await vi.waitFor(() => {
			const rowIndexes = getRows(root).map((row) =>
				Number(row.dataset.cclRowIndex),
			);
			expect(Math.min(...rowIndexes)).toBeGreaterThan(100);
		});
		await waitForStableRowCount(root);

		resetCCLDevMeasurements();

		setNumericProperty(scroller, "scrollTop", 10_000);
		await fireEvent.scroll(scroller);
		await vi.waitFor(() => {
			const rowIndexes = getRows(root).map((row) =>
				Number(row.dataset.cclRowIndex),
			);
			expect(Math.min(...rowIndexes)).toBeGreaterThan(50);
			expect(Math.max(...rowIndexes)).toBeLessThan(200);
		});
		await waitForStableRowCount(root);

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["twoHop.cellBody.rebind"].count).toBeGreaterThan(0);
		expect(counters["twoHop.cellBody.mount"].count).toBe(0);
		expect(counters["twoHop.cellBody.unmount"].count).toBe(0);
	});
});
