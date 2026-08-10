import { render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import type { TFile } from "obsidian";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import {
	flushFrames,
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
import { createPreviewSurfaceProbe, type PreviewFrame } from "./previewSurfaceProbe";

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

function createSection(count: number): TwoHopSectionModel {
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
		totalCount: items.length,
	});
}

interface HydrationSchedulingFixture {
	readonly resolveItemCardModel: ReturnType<typeof vi.fn>;
	readonly resolveInteractionDescriptor: ReturnType<typeof vi.fn>;
	readonly resolvePreviewRequest: ReturnType<typeof vi.fn>;
	readonly root: HTMLElement;
	readonly scrollTarget: HTMLElement | Window;
	rerenderCardModels(
		revision: unknown,
		resolver: (
			item: TwoHopItemModel,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel,
	): Promise<void>;
}

interface PreviewControlFixture {
	readonly disposeHost: ReturnType<typeof vi.fn>;
	readonly publish: ReturnType<typeof vi.fn>;
	readonly registerHost: ReturnType<typeof vi.fn>;
	readonly resolvePreviewRequest: ReturnType<typeof vi.fn>;
	readonly root: HTMLElement;
	readonly scrollTarget: HTMLElement | Window;
	rerenderPreviewActive(active: boolean): Promise<void>;
	rerenderCardModels(
		revision: unknown,
		resolver: (
			item: TwoHopItemModel,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel,
	): Promise<void>;
}

async function renderPreviewControlFixture(
	previewActive: boolean,
	initialScrollTop = 0,
): Promise<PreviewControlFixture> {
	const applicationStore = {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 100,
			cardHeightRatio: 1,
			cardMaxColumns: 3,
		},
	} as unknown as ApplicationStore;
	const targetFile = {
		path: "notes/preview.md",
		basename: "preview",
		extension: "md",
		parent: { path: "notes" },
		stat: { ctime: 1, mtime: 1, size: 1 },
	} as TFile;
	const requestsByKey = new Map<string, CardPreviewRequest>();
	const resolvePreviewRequest = vi.fn((item: TwoHopItemModel) => {
		const existing = requestsByKey.get(item.key);
		if (existing) return existing;
		const request = {
			renderKey: `preview:${item.key}`,
		} as CardPreviewRequest;
		requestsByKey.set(item.key, request);
		return request;
	});
	const resolveItemCardModel = (
		item: TwoHopItemModel,
		presentation: TwoHopCardPresentationState,
	): CardRenderModel => ({
		item: item.item,
		targetFile,
		title: item.key,
		ariaLabel: item.key,
		className: null,
		extension: "md",
		directory: "notes",
		interactionId: item.key,
		interactionKey: item.key,
		interactionDescriptor: null,
		presentation,
		searchQuery: "",
		get previewRequest() {
			return resolvePreviewRequest(item);
		},
	});
	const disposeHost = vi.fn();
	const registerHost = vi.fn(() => ({ dispose: disposeHost }));
	const surfaceProbe = createPreviewSurfaceProbe(registerHost);
	const publish = surfaceProbe.publish;
	const previewDependencies = {
		previewRuntime: {
			createSurface: () => surfaceProbe.surface,
		},
		resolveSearchMatchPosition: () => undefined,
	} as unknown as TwoHopPreviewDependencies;
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientHeight", 300);
	setNumericProperty(scroller, "scrollHeight", 20_000);
	setNumericProperty(scroller, "scrollTop", initialScrollTop);
	setElementRect(scroller, { top: 0, width: 320, height: 300 });
	document.body.append(scroller);
	const baseProps = {
		sections: [createSection(300)],
		applicationStore,
		linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
		previewDependencies,
		resolveItemCardModel,
	};
	const rendered = render(TwoHopProgressiveSurfaceHarness, {
		target: scroller,
		props: { ...baseProps, previewActive },
	});
	const root = rendered.container.querySelector<HTMLElement>(
		".twohop-progressive-surface",
	);
	if (!root) throw new Error("Progressive surface was not rendered");
	setElementRect(root, { top: 0, width: 320, height: 20_000 });
	const content = root.shadowRoot?.querySelector<HTMLElement>(
		".twohop-progressive-content",
	);
	if (!content) throw new Error("Progressive content was not rendered");
	setElementRect(content, {
		top: -initialScrollTop,
		width: 320,
		height: 20_000,
	});
	triggerResize(root, 320, 20_000);
	setNumericProperty(scroller, "clientHeight", 301);
	triggerResize(scroller, 320, 301);
	await flushFrames();
	await drainPostPaintTasks();

	return {
		disposeHost,
		publish,
		registerHost,
		resolvePreviewRequest,
		root,
		scrollTarget: findNearestScrollContainer(root) ?? window,
		async rerenderPreviewActive(active: boolean): Promise<void> {
			await rendered.rerender({ ...baseProps, previewActive: active });
			await Promise.resolve();
			await drainPostPaintTasks();
		},
		async rerenderCardModels(revision, resolver): Promise<void> {
			await rendered.rerender({
				...baseProps,
				cardModelRevision: revision,
				resolveItemCardModel: resolver,
			});
			await Promise.resolve();
		},
	};
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
	const resolveInteractionDescriptor = vi.fn((_item: TwoHopItemModel) => null);
	const resolvePreviewRequest = vi.fn((_item: TwoHopItemModel) => null);
	const resolveItemCardModel = vi.fn(
		(
			item: TwoHopItemModel,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => ({
			item: item.item,
			targetFile: null,
			title: item.key,
			ariaLabel: item.key,
			className: null,
			extension: null,
			directory: null,
			interactionId: item.key,
			interactionKey: item.key,
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
	const linkContext = { getPreview: vi.fn() } as unknown as LinkContext;
	const baseProps = {
		sections: [createSection(itemCount)],
		applicationStore,
		linkContext,
	};
	const rendered = render(TwoHopProgressiveSurfaceHarness, {
		target: scroller,
		props: {
			...baseProps,
			cardModelRevision: 0,
			resolveItemCardModel,
		},
	});
	const root = rendered.container.querySelector<HTMLElement>(
		".twohop-progressive-surface",
	);
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
		async rerenderCardModels(revision, resolver): Promise<void> {
			await rendered.rerender({
				...baseProps,
				cardModelRevision: revision,
				resolveItemCardModel: resolver,
			});
			await Promise.resolve();
		},
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
		const twoHopItem = item as TwoHopItemModel;
		return Number(twoHopItem.key.slice("item:".length));
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
	it("hydrates offscreen bootstrap rows on mount while preview control is inactive", async () => {
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
		const resolvePreviewRequest = vi.fn(() => null);
		const resolveItemCardModel = vi.fn(
			(
				item: TwoHopItemModel,
				presentation: TwoHopCardPresentationState,
			): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.key,
				ariaLabel: item.key,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.key,
				interactionKey: item.key,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				get previewRequest() {
					return resolvePreviewRequest();
				},
			}),
		);
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		document.body.append(scroller);

		const rendered = render(TwoHopProgressiveSurfaceHarness, {
			target: scroller,
			props: {
				sections: [createSection(100)],
				applicationStore,
				linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
				previewActive: false,
				offscreenBootstrapPreviewRows: 4,
				resolveItemCardModel,
			},
		});
		const root = rendered.container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		if (!root) throw new Error("Progressive surface was not rendered");
		const content = root.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-content",
		);
		if (!content) throw new Error("Progressive content was not rendered");
		setElementRect(root, { top: 1_000, width: 320, height: 20_000 });
		setElementRect(content, { top: 1_000, width: 320, height: 20_000 });
		triggerResize(root, 320, 20_000);
		setNumericProperty(scroller, "clientHeight", 301);
		triggerResize(scroller, 320, 301);

		await Promise.resolve();
		await drainPostPaintTasks();

		const resolvedItemIndexes = readResolvedItemIndexes(resolveItemCardModel);
		expect(resolvedItemIndexes.length).toBeGreaterThan(0);
		expect(resolvedItemIndexes.every((index) => index < 11)).toBe(true);
		expect(resolvePreviewRequest).not.toHaveBeenCalled();
	});

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

	it("reuses the skeleton card root when the first model is hydrated", async () => {
		const fixture = await renderHydrationSchedulingFixture();
		const firstCell = fixture.root.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='twohop-progressive-item-cell']",
		);
		if (!firstCell) throw new Error("Progressive item cell was not rendered");
		const card = firstCell.querySelector<HTMLElement>(".cosense-card-links__box");
		if (!card) throw new Error("Progressive card shell was not rendered");

		expect(card).toHaveClass("is-skeleton");
		expect(card).toHaveAttribute("aria-hidden", "true");
		expect(card).not.toHaveAttribute("role");

		await runTask("post-paint", HYDRATION_POST_PAINT_TASK_KEY);

		expect(firstCell.querySelector(".cosense-card-links__box")).toBe(card);
		expect(card).not.toHaveClass("is-skeleton");
		expect(card).not.toHaveAttribute("aria-hidden");
		expect(card).toHaveAttribute("role", "button");
		expect(card).toHaveAttribute("aria-label", "item:0");
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

	it("keeps stale cards rendered until the revised model is hydrated", async () => {
		const fixture = await renderHydrationSchedulingFixture();
		await drainPostPaintTasks();
		const itemCells = Array.from(
			fixture.root.shadowRoot?.querySelectorAll<HTMLElement>(
				"[data-testid='twohop-progressive-item-cell']",
			) ?? [],
		);
		const firstCell = itemCells[0];
		const secondCell = itemCells[1];
		if (!firstCell || !secondCell) {
			throw new Error("Progressive item cells were not rendered");
		}
		const firstCard = firstCell.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);
		if (!firstCard) throw new Error("First card was not hydrated");

		const equivalentResolver = vi.fn(
			(
				item: TwoHopItemModel,
				presentation: TwoHopCardPresentationState,
			): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.key,
				ariaLabel: `revised:${item.key}`,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.key,
				interactionKey: item.key,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: null,
			}),
		);
		await fixture.rerenderCardModels(1, equivalentResolver);

		expect(firstCell.querySelector(".is-skeleton")).toBeNull();
		expect(firstCell.querySelector(".cosense-card-links__box")).toBe(firstCard);
		expect(firstCard).toHaveAttribute("aria-label", "item:0");
		await drainPostPaintTasks();
		expect(equivalentResolver).toHaveBeenCalled();
		expect(firstCard).toHaveAttribute("aria-label", "revised:item:0");

		const changedResolver = vi.fn(
			(
				item: TwoHopItemModel,
				presentation: TwoHopCardPresentationState,
			): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.key === "item:0" ? "changed-title" : item.key,
				ariaLabel: item.key,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.key,
				interactionKey: item.key,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: null,
			}),
		);
		const secondCard = secondCell.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);
		await fixture.rerenderCardModels(2, changedResolver);
		expect(firstCell.querySelector(".is-skeleton")).toBeNull();
		await drainPostPaintTasks();

		expect(
			firstCell.querySelector(".cosense-card-links__box-title"),
		).toHaveTextContent("changed-title");
		expect(secondCell.querySelector(".cosense-card-links__box")).toBe(secondCard);
	});

	it("retains preview bindings until their render key changes", async () => {
		const fixture = await renderPreviewControlFixture(true);
		await vi.waitFor(() => expect(fixture.registerHost).toHaveBeenCalled());
		const targetFile = {
			path: "notes/preview.md",
			basename: "preview",
			extension: "md",
			parent: { path: "notes" },
			stat: { ctime: 1, mtime: 1, size: 1 },
		} as TFile;
		function createResolver(changedItemKey?: string) {
			return vi.fn(
				(
					item: TwoHopItemModel,
					presentation: TwoHopCardPresentationState,
				): CardRenderModel => ({
					item: item.item,
					targetFile,
					title: item.key,
					ariaLabel: item.key,
					className: null,
					extension: "md",
					directory: "notes",
					interactionId: item.key,
					interactionKey: item.key,
					interactionDescriptor: null,
					presentation,
					searchQuery: "",
					previewRequest: {
						renderKey:
							item.key === changedItemKey
								? `changed:${item.key}`
								: `preview:${item.key}`,
					} as CardPreviewRequest,
				}),
			);
		}

		fixture.publish.mockClear();
		fixture.disposeHost.mockClear();
		const equivalentResolver = createResolver();
		await fixture.rerenderCardModels(1, equivalentResolver);
		await drainPostPaintTasks();
		await drainIdleTasks();
		expect(equivalentResolver).toHaveBeenCalled();
		expect(fixture.publish).not.toHaveBeenCalled();
		expect(fixture.disposeHost).not.toHaveBeenCalled();

		const changedResolver = createResolver("item:0");
		await fixture.rerenderCardModels(2, changedResolver);
		await drainPostPaintTasks();
		await Promise.resolve();
		expect(fixture.publish).toHaveBeenCalled();
		const frame = fixture.publish.mock.lastCall?.[0] as PreviewFrame | undefined;
		expect(
			Array.from(frame?.previewBindingsBySlot.values() ?? []).some(
				(binding) => binding.request.renderKey === "changed:item:0",
			),
		).toBe(true);
		expect(fixture.disposeHost).not.toHaveBeenCalled();
	});

	it("refreshes stale offscreen models only after they become visible again", async () => {
		const fixture = await renderHydrationSchedulingFixture();
		await drainPostPaintTasks();
		await applyScrollRange(fixture.scrollTarget, 2_000);
		await drainPostPaintTasks();
		await applyScrollRange(fixture.scrollTarget, 0);
		await drainPostPaintTasks();

		const refreshedResolver = vi.fn(
			(
				item: TwoHopItemModel,
				presentation: TwoHopCardPresentationState,
			): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.key,
				ariaLabel: item.key,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.key,
				interactionKey: item.key,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: null,
			}),
		);
		await fixture.rerenderCardModels(1, refreshedResolver);
		await drainPostPaintTasks();
		await drainIdleTasks();

		expect(
			readResolvedItemIndexes(refreshedResolver).every((index) => index < 20),
		).toBe(true);
		await applyScrollRange(fixture.scrollTarget, 2_000);
		await drainPostPaintTasks();
		expect(
			readResolvedItemIndexes(refreshedResolver).some((index) => index >= 20),
		).toBe(true);
	});

	it("does not couple progressive chunk mounting to card-model preload", async () => {
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

		expect(fixture.resolveItemCardModel).not.toHaveBeenCalled();
		expect(fixture.resolveInteractionDescriptor).not.toHaveBeenCalled();
		expect(fixture.resolvePreviewRequest).not.toHaveBeenCalled();
	});

	it("applies the range only after the scroll-critical calculation reaches post-paint", async () => {
		const surfaceProbe = createPreviewSurfaceProbe();
		const publish = surfaceProbe.publish;
		const previewDependencies = {
			previewRuntime: {
				createSurface: () => surfaceProbe.surface,
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
			item: TwoHopItemModel,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => ({
			item: item.item,
			targetFile: null,
			title: item.key,
			ariaLabel: item.key,
			className: null,
			extension: null,
			directory: null,
			interactionId: item.key,
			interactionKey: item.key,
			interactionDescriptor: null,
			presentation,
			searchQuery: "",
			previewRequest: {
				renderKey: `preview:${item.key}`,
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

	it("keeps prepared hosts and bindings when active rows move inside the guard", async () => {
		const initialScrollTop = 1_000;
		const fixture = await renderPreviewControlFixture(true, initialScrollTop);
		await vi.waitFor(() => expect(fixture.registerHost).toHaveBeenCalled());
		await drainIdleTasks();
		const firstFrame = fixture.publish.mock.lastCall?.[0] as
			| PreviewFrame
			| undefined;
		if (!firstFrame) throw new Error("Initial preview frame was not published");
		const activeRowCount =
			firstFrame.previewWindow.previewRange.end -
			firstFrame.previewWindow.previewRange.start;
		const columnCount = fixture.root.shadowRoot?.querySelector(
			"[data-ccl-progressive-row]",
		)?.childElementCount;
		if (!columnCount) throw new Error("Progressive grid columns were not rendered");
		expect(fixture.registerHost.mock.calls.length).toBeLessThanOrEqual(
			(activeRowCount + 4) * columnCount,
		);
		const rows = [
			...(fixture.root.shadowRoot?.querySelectorAll<HTMLElement>(
				".twohop-progressive-row",
			) ?? []),
		];
		const firstRowTop = Number.parseFloat(rows[0]?.style.top ?? "0");
		const secondRowTop = Number.parseFloat(rows[1]?.style.top ?? "0");
		const rowStride = secondRowTop - firstRowTop;
		expect(rowStride).toBeGreaterThan(0);
		await applyScrollRange(fixture.scrollTarget, initialScrollTop - rowStride);
		await drainPostPaintTasks();
		await drainIdleTasks();
		const initialFrame = fixture.publish.mock.lastCall?.[0] as
			| PreviewFrame
			| undefined;
		if (!initialFrame) throw new Error("Initial preview frame was not published");
		fixture.disposeHost.mockClear();

		await applyScrollRange(fixture.scrollTarget, initialScrollTop);
		await drainPostPaintTasks();
		const nextFrame = fixture.publish.mock.lastCall?.[0] as PreviewFrame;

		expect(nextFrame.previewWindow.previewRange.start).toBe(
			initialFrame.previewWindow.previewRange.start + 1,
		);
		expect(nextFrame.previewBindingsBySlot).toBe(
			initialFrame.previewBindingsBySlot,
		);
		expect(fixture.disposeHost).not.toHaveBeenCalled();
		const retainedInactiveBindings = [
			...nextFrame.previewBindingsBySlot.values(),
		].filter(
			(binding) => binding.rowIndex < nextFrame.previewWindow.previewRange.start,
		);
		expect(retainedInactiveBindings.length).toBeGreaterThan(0);
		for (const binding of retainedInactiveBindings) {
			expect(initialFrame.previewBindingsBySlot.get(binding.slotId)).toBe(
				binding,
			);
		}
	});

	it("stops preview lazy work and hosts while inactive, then rebuilds from current scroll", async () => {
		const fixture = await renderPreviewControlFixture(false, 1_000);

		expect(fixture.resolvePreviewRequest).not.toHaveBeenCalled();
		expect(fixture.registerHost).not.toHaveBeenCalled();
		expect(
			fixture.root.shadowRoot?.querySelectorAll(
				"[data-preview-owner='virtual-surface']",
			),
		).toHaveLength(0);
		const inactiveFrame = fixture.publish.mock.lastCall?.[0] as PreviewFrame;
		expect(inactiveFrame.previewWindow.active).toBe(false);
		expect(inactiveFrame.previewBindingsBySlot.size).toBe(0);
		const inactivePublishCount = fixture.publish.mock.calls.length;

		setNumericProperty(fixture.scrollTarget, "scrollTop", 1_500);
		fixture.scrollTarget.dispatchEvent(new Event("scroll"));
		await runTask("scroll-critical", PREVIEW_SCROLL_TASK_KEY);
		await runTask("post-paint", PREVIEW_RANGE_APPLY_TASK_KEY);
		expect(fixture.resolvePreviewRequest).not.toHaveBeenCalled();
		expect(fixture.registerHost).not.toHaveBeenCalled();
		expect(fixture.publish).toHaveBeenCalledTimes(inactivePublishCount);

		await fixture.rerenderPreviewActive(true);
		await vi.waitFor(() => expect(fixture.registerHost).toHaveBeenCalled());
		const activeFrame = fixture.publish.mock.lastCall?.[0] as PreviewFrame;
		expect(activeFrame.previewWindow.active).toBe(true);
		expect(activeFrame.previewWindow.previewRange.start).toBeGreaterThan(0);
		expect(fixture.resolvePreviewRequest).toHaveBeenCalled();

		fixture.disposeHost.mockClear();
		await fixture.rerenderPreviewActive(false);
		await vi.waitFor(() =>
			expect(
				fixture.root.shadowRoot?.querySelectorAll(
					"[data-preview-owner='virtual-surface']",
				),
			).toHaveLength(0),
		);
		expect(fixture.disposeHost).toHaveBeenCalled();
		const finalFrame = fixture.publish.mock.lastCall?.[0] as PreviewFrame;
		expect(finalFrame.previewWindow.active).toBe(false);
		expect(finalFrame.previewBindingsBySlot.size).toBe(0);
	});
});
