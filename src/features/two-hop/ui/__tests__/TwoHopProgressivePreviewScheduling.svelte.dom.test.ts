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
