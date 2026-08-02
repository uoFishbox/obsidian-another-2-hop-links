import { render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type { PreviewFrame } from "features/preview/scheduling/virtualPreviewSurface";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";
import { TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK } from "features/two-hop/ui/twoHopProgressivePlan";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import {
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
	triggerIntersection,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import TwoHopProgressiveSurfaceHarness from "./TwoHopProgressiveSurfaceHarness.svelte";

type TestLane = "scroll-critical" | "post-paint" | "idle";

const scheduling = vi.hoisted(() => {
	const tasks = {
		"scroll-critical": new Map<string, () => void>(),
		"post-paint": new Map<string, () => void>(),
		idle: new Map<string, () => void>(),
	};
	return {
		tasks,
		coordinator: {
			schedule: (
				lane: "scroll-critical" | "post-paint" | "idle",
				key: string,
				task: () => void,
			): boolean => {
				if (tasks[lane].has(key)) return false;
				tasks[lane].set(key, task);
				return true;
			},
			cancel: (
				lane: "scroll-critical" | "post-paint" | "idle",
				key: string,
			): void => {
				tasks[lane].delete(key);
			},
			isScheduled: (
				lane: "scroll-critical" | "post-paint" | "idle",
				key: string,
			): boolean => tasks[lane].has(key),
			dispose: (): void => {
				for (const queue of Object.values(tasks)) queue.clear();
			},
		},
	};
});

vi.mock("ui/virtualization/svelte/frameCoordinatorContext.svelte", () => ({
	provideVirtualFrameCoordinator: () => scheduling.coordinator,
}));

const PREVIEW_SCROLL_TASK_KEY = "two-hop-progressive-preview-window";
const PREVIEW_RANGE_APPLY_TASK_KEY = "two-hop-progressive-preview-window-apply";
const HYDRATION_POST_PAINT_TASK_KEY = "two-hop-progressive-hydration-visible";

function createSection(count: number): TwoHopVirtualSectionDescriptor {
	const items = Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	return {
		sourceRevision: createSectionDataRevision(1),
		section: {
			kind: "new-links-section",
			rawSectionId: "section",
			sectionId: "section",
			sectionKey: "section",
			title: "Section",
		},
		sectionKey: "section",
		sectionId: "section",
		title: "Section",
		totalCount: count,
		loadedCount: count,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
}

interface HydrationSchedulingFixture {
	readonly resolveItemCardModel: ReturnType<typeof vi.fn>;
	readonly resolveInteractionDescriptor: ReturnType<typeof vi.fn>;
	readonly resolvePreviewRequest: ReturnType<typeof vi.fn>;
	readonly root: HTMLElement;
	readonly scrollTarget: HTMLElement | Window;
}

async function renderHydrationSchedulingFixture(
	itemCount = 100,
): Promise<HydrationSchedulingFixture> {
	const applicationStore = {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 100,
			cardHeightRatio: 1,
			cardMaxColumns: 3,
		},
	} as unknown as ApplicationStore;
	const resolveInteractionDescriptor = vi.fn((_item: TwoHopVirtualListItem) => null);
	const resolvePreviewRequest = vi.fn((_item: TwoHopVirtualListItem) => null);
	const resolveItemCardModel = vi.fn(
		(
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => ({
			item: item.item,
			targetFile: null,
			title: item.virtualKey,
			ariaLabel: item.virtualKey,
			className: null,
			extension: null,
			directory: null,
			interactionId: item.virtualKey,
			interactionKey: item.virtualKey,
			get interactionDescriptor() {
				return resolveInteractionDescriptor(item);
			},
			presentation,
			searchQuery: "",
			get previewRequest() {
				return resolvePreviewRequest(item);
			},
		}),
	);
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientHeight", 300);
	setNumericProperty(scroller, "scrollHeight", 20_000);
	setElementRect(scroller, { top: 0, width: 320, height: 300 });
	document.body.append(scroller);
	const { container } = render(TwoHopProgressiveSurfaceHarness, {
		target: scroller,
		props: {
			sections: [createSection(itemCount)],
			applicationStore,
			linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
			resolveItemCardModel,
		},
	});
	const root = container.querySelector<HTMLElement>(".twohop-progressive-surface");
	if (!root) throw new Error("Progressive surface was not rendered");
	setElementRect(root, { top: 0, width: 320, height: 20_000 });
	triggerResize(root, 320, 20_000);
	await Promise.resolve();
	await runTask("post-paint", PREVIEW_RANGE_APPLY_TASK_KEY);

	return {
		resolveItemCardModel,
		resolveInteractionDescriptor,
		resolvePreviewRequest,
		root,
		scrollTarget: findNearestScrollContainer(root) ?? window,
	};
}

async function applyScrollRange(
	scrollTarget: HTMLElement | Window,
	scrollTop: number,
): Promise<void> {
	setNumericProperty(scrollTarget, "scrollTop", scrollTop);
	if (scrollTarget === window) setNumericProperty(window, "scrollY", scrollTop);
	scrollTarget.dispatchEvent(new Event("scroll"));
	await runTask("scroll-critical", PREVIEW_SCROLL_TASK_KEY);
	await runTask("post-paint", PREVIEW_RANGE_APPLY_TASK_KEY);
}

function readResolvedItemIndexes(
	resolveItemCardModel: ReturnType<typeof vi.fn>,
): number[] {
	return resolveItemCardModel.mock.calls.map(([item]) => {
		const virtualItem = item as TwoHopVirtualListItem;
		return Number(virtualItem.virtualKey.slice("item:".length));
	});
}

async function runTask(lane: TestLane, key: string): Promise<void> {
	const task = scheduling.tasks[lane].get(key);
	if (!task) throw new Error(`Missing ${lane} task: ${key}`);
	scheduling.tasks[lane].delete(key);
	task();
	await Promise.resolve();
	await Promise.resolve();
}

async function drainPostPaintTasks(): Promise<void> {
	for (let index = 0; index < 30; index += 1) {
		const key = scheduling.tasks["post-paint"].keys().next().value as
			| string
			| undefined;
		if (!key) return;
		await runTask("post-paint", key);
	}
	throw new Error("Post-paint tasks did not settle");
}

async function drainIdleTasks(): Promise<void> {
	for (let index = 0; index < 200; index += 1) {
		const key = scheduling.tasks.idle.keys().next().value as string | undefined;
		if (!key) return;
		await runTask("idle", key);
	}
	throw new Error("Idle tasks did not settle");
}

beforeEach(() => {
	resetRecords();
	for (const queue of Object.values(scheduling.tasks)) queue.clear();
	installResizeObserverMock();
	installIntersectionObserverMock();
});

afterEach(() => {
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
});

describe("TwoHop progressive preview scheduling", () => {
	it("hydrates range B first when the visible range changes before range A drains", async () => {
		const fixture = await renderHydrationSchedulingFixture();

		await applyScrollRange(fixture.scrollTarget, 2_000);
		await runTask("post-paint", HYDRATION_POST_PAINT_TASK_KEY);

		const resolvedItemIndexes = readResolvedItemIndexes(
			fixture.resolveItemCardModel,
		);
		expect(resolvedItemIndexes.length).toBeGreaterThan(0);
		expect(resolvedItemIndexes.every((index) => index >= 20)).toBe(true);
	});

	it("re-enqueues range A after returning from range B", async () => {
		const fixture = await renderHydrationSchedulingFixture();
		await applyScrollRange(fixture.scrollTarget, 2_000);
		await runTask("post-paint", HYDRATION_POST_PAINT_TASK_KEY);
		const callCountAfterRangeB = fixture.resolveItemCardModel.mock.calls.length;

		await applyScrollRange(fixture.scrollTarget, 0);
		await runTask("post-paint", HYDRATION_POST_PAINT_TASK_KEY);

		const rangeAIndexes = readResolvedItemIndexes(
			fixture.resolveItemCardModel,
		).slice(callCountAfterRangeB);
		expect(rangeAIndexes).toContain(0);
	});

	it("does not regenerate hydrated models when returning to their range", async () => {
		const fixture = await renderHydrationSchedulingFixture();
		await drainPostPaintTasks();
		const initialResolvedIndexes = readResolvedItemIndexes(
			fixture.resolveItemCardModel,
		);

		await applyScrollRange(fixture.scrollTarget, 2_000);
		await applyScrollRange(fixture.scrollTarget, 0);
		await drainPostPaintTasks();

		expect(readResolvedItemIndexes(fixture.resolveItemCardModel)).toEqual(
			initialResolvedIndexes,
		);
	});

	it("preloads only the one chunk immediately after the visible range", async () => {
		const fixture = await renderHydrationSchedulingFixture(600);
		await drainPostPaintTasks();
		fixture.resolveItemCardModel.mockClear();
		fixture.resolveInteractionDescriptor.mockClear();
		fixture.resolvePreviewRequest.mockClear();

		for (
			let expectedChunkCount = 3;
			expectedChunkCount <= 7;
			expectedChunkCount += 1
		) {
			const sentinel = fixture.root.shadowRoot?.querySelector<HTMLElement>(
				".twohop-progressive-sentinel",
			);
			if (!sentinel) throw new Error("Progressive sentinel was not rendered");
			triggerIntersection(sentinel);
			await vi.waitFor(() =>
				expect(
					fixture.root.shadowRoot?.querySelectorAll(
						".twohop-progressive-chunk",
					).length,
				).toBe(expectedChunkCount),
			);
		}

		await drainIdleTasks();

		const resolvedItemIndexes = readResolvedItemIndexes(
			fixture.resolveItemCardModel,
		);
		const columnCount = fixture.root.shadowRoot?.querySelector(
			"[data-ccl-progressive-row='0']",
		)?.childElementCount;
		if (!columnCount) throw new Error("Progressive grid columns were not rendered");
		expect(resolvedItemIndexes.length).toBeGreaterThan(0);
		expect(resolvedItemIndexes).toHaveLength(
			TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * columnCount,
		);
		const firstPreloadedItemIndex =
			TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * columnCount - 1;
		const afterPreloadedItemIndex =
			TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * 2 * columnCount - 1;
		expect(
			resolvedItemIndexes.every(
				(index) =>
					index >= firstPreloadedItemIndex && index < afterPreloadedItemIndex,
			),
		).toBe(true);
		expect(fixture.resolveInteractionDescriptor).not.toHaveBeenCalled();
		expect(fixture.resolvePreviewRequest).not.toHaveBeenCalled();
	});

	it("applies the range only after the scroll-critical calculation reaches post-paint", async () => {
		const publish = vi.fn();
		const previewDependencies = {
			previewRuntime: {
				createSurface: () => ({
					registerHost: () => ({ dispose: () => {} }),
					publish,
					dispose: () => {},
				}),
			},
			resolveSearchMatchPosition: () => undefined,
		} as unknown as TwoHopPreviewDependencies;
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
		const resolveItemCardModel = (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => ({
			item: item.item,
			targetFile: null,
			title: item.virtualKey,
			ariaLabel: item.virtualKey,
			className: null,
			extension: null,
			directory: null,
			interactionId: item.virtualKey,
			interactionKey: item.virtualKey,
			interactionDescriptor: null,
			presentation,
			searchQuery: "",
			previewRequest: {
				renderKey: `preview:${item.virtualKey}`,
			} as CardPreviewRequest,
		});
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		document.body.append(scroller);

		const { container } = render(TwoHopProgressiveSurfaceHarness, {
			target: scroller,
			props: {
				sections: [createSection(100)],
				applicationStore,
				linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
				previewDependencies,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		if (!root) throw new Error("Progressive surface was not rendered");
		setElementRect(root, { top: 0, width: 320, height: 20_000 });
		triggerResize(root, 320, 20_000);
		await Promise.resolve();
		await drainPostPaintTasks();
		await Promise.resolve();
		const initialFrame = publish.mock.lastCall?.[0] as PreviewFrame | undefined;
		if (!initialFrame) throw new Error("Initial preview frame was not published");
		publish.mockClear();

		const scrollTarget = findNearestScrollContainer(root) ?? window;
		setNumericProperty(scrollTarget, "scrollTop", 700);
		scrollTarget.dispatchEvent(new Event("scroll"));
		expect(scheduling.tasks["scroll-critical"].has(PREVIEW_SCROLL_TASK_KEY)).toBe(
			true,
		);
		expect(publish).not.toHaveBeenCalled();

		await runTask("scroll-critical", PREVIEW_SCROLL_TASK_KEY);
		expect(publish).not.toHaveBeenCalled();
		expect(scheduling.tasks["post-paint"].has(PREVIEW_RANGE_APPLY_TASK_KEY)).toBe(
			true,
		);

		await runTask("post-paint", PREVIEW_RANGE_APPLY_TASK_KEY);
		expect(publish).toHaveBeenCalledOnce();
		const nextFrame = publish.mock.calls[0]?.[0] as PreviewFrame;
		expect(nextFrame.previewWindow.previewRange.start).toBeGreaterThan(
			initialFrame.previewWindow.previewRange.start,
		);
	});
});
