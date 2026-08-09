import { fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import { compileCardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import type { TFile } from "obsidian";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import { RESULT_FOCUS_SELECTOR } from "features/keyboard-navigation/resultFocus";
import {
	isScrollActivityActive,
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "ui/virtualization/scheduling/scrollActivity";
import {
	createDomRect,
	flushFrames,
	intersectionObserverRecords,
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	resizeObserverRecords,
	setElementRect,
	setNumericProperty,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
	triggerIntersection,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import TwoHopProgressiveSurfaceHarness from "./TwoHopProgressiveSurfaceHarness.svelte";
import { createPreviewSurfaceProbe, type PreviewFrame } from "./previewSurfaceProbe";

function createSection(count: number): TwoHopSectionModel {
	const items = Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		key: `item:${index}`,
	})) as TwoHopItemModel[];
	return createTwoHopSectionModel({
		id: "section",
		key: "section",
		kind: "new-links-section",
		title: "Section",
		items,
	});
}

function createCardModelResolver() {
	return vi.fn(
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
}

async function waitForCardHydrationToSettle(
	resolver: ReturnType<typeof vi.fn>,
): Promise<void> {
	let previousCallCount = resolver.mock.calls.length;
	let stableFrameCount = 0;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		await waitForNextAnimationFrame();
		const currentCallCount = resolver.mock.calls.length;
		if (currentCallCount === previousCallCount) {
			stableFrameCount += 1;
			if (stableFrameCount >= 2) return;
			continue;
		}
		previousCallCount = currentCallCount;
		stableFrameCount = 0;
	}
	throw new Error("Card hydration did not settle");
}

async function waitForNextAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => {
		if (typeof window.requestAnimationFrame === "function") {
			window.requestAnimationFrame(() => resolve());
			return;
		}
		window.setTimeout(resolve, 0);
	});
	await Promise.resolve();
}

async function renderAnchorTestSurface() {
	const applicationStore = {
		settings: {
			...DEFAULT_SETTINGS,
			cardWidthPx: 100,
			cardHeightRatio: 1,
			cardMaxColumns: 3,
		},
	} as unknown as ApplicationStore;
	const resolveItemCardModel = createCardModelResolver();
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientWidth", 320);
	setNumericProperty(scroller, "clientHeight", 300);
	setNumericProperty(scroller, "scrollHeight", 20_000);
	setNumericProperty(scroller, "scrollTop", 0);
	setElementRect(scroller, { top: 0, width: 320, height: 300 });
	document.body.append(scroller);
	const section = createSection(300);
	const linkContext = { getPreview: vi.fn() } as unknown as LinkContext;
	const rendered = render(TwoHopProgressiveSurfaceHarness, {
		target: scroller,
		props: {
			documentIdentity: "anchor-test",
			sections: [section],
			applicationStore,
			linkContext,
			resolveItemCardModel,
		},
	});
	const root = rendered.container.querySelector<HTMLElement>(
		".twohop-progressive-surface",
	);
	if (!root) throw new Error("Progressive surface was not rendered");

	await flushFrames();
	await vi.waitFor(() => expect(resolveItemCardModel).toHaveBeenCalled());
	for (let index = 0; index < 2; index += 1) {
		const sentinel = root.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-sentinel",
		);
		if (!sentinel) throw new Error("Progressive sentinel was not rendered");
		triggerIntersection(sentinel);
		await flushFrames();
	}
	setNumericProperty(scroller, "scrollTop", 2_500);
	await fireEvent.scroll(scroller);
	await flushFrames();

	const anchorCell = root.shadowRoot?.querySelector<HTMLElement>(
		"[data-ccl-row-index='22'][data-ccl-column-index='0']",
	);
	if (!anchorCell) throw new Error("Progressive anchor cell was not rendered");

	return {
		anchorCell,
		applicationStore,
		linkContext,
		rendered,
		resolveItemCardModel,
		root,
		scroller,
		section,
	};
}

beforeEach(() => {
	resetRecords();
	resetScrollActivityForTests();
	setNumericProperty(window, "scrollY", 0);
	installResizeObserverMock();
	installIntersectionObserverMock();
});

afterEach(() => {
	resetScrollActivityForTests();
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
});

describe("TwoHopProgressiveSurface", () => {
	it("preserves the resident prefix and anchor for data revisions, then resets for a new identity", async () => {
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
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
				previewRequest: null,
			}),
		);
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientWidth", 320);
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setNumericProperty(scroller, "scrollTop", 0);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		document.body.append(scroller);
		const section = createSection(300);
		const linkContext = { getPreview: vi.fn() } as unknown as LinkContext;
		const rendered = render(TwoHopProgressiveSurfaceHarness, {
			target: scroller,
			props: {
				documentIdentity: "first",
				sections: [section],
				applicationStore,
				linkContext,
				resolveItemCardModel,
			},
		});
		const root = rendered.container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		if (!root) throw new Error("Progressive surface was not rendered");

		await flushFrames();
		await vi.waitFor(() => expect(resolveItemCardModel).toHaveBeenCalled());
		await waitForCardHydrationToSettle(resolveItemCardModel);
		for (let index = 0; index < 2; index += 1) {
			const sentinel = root.shadowRoot?.querySelector<HTMLElement>(
				".twohop-progressive-sentinel",
			);
			if (!sentinel) throw new Error("Progressive sentinel was not rendered");
			triggerIntersection(sentinel);
			await flushFrames();
		}
		expect(
			root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
		).toHaveLength(4);

		setNumericProperty(scroller, "scrollTop", 2_500);
		await fireEvent.scroll(scroller);
		await flushFrames();
		const cells = Array.from(
			root.shadowRoot?.querySelectorAll<HTMLElement>("[data-ccl-logical-key]") ??
				[],
		);
		const rectSpies = cells.map((cell) =>
			vi
				.spyOn(cell, "getBoundingClientRect")
				.mockReturnValue(createDomRect({ top: 0, width: 100, height: 100 })),
		);
		const anchorCell = root.shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-row-index='22'][data-ccl-column-index='0']",
		);
		if (!anchorCell) throw new Error("Progressive anchor cell was not rendered");
		const anchorRect = vi
			.spyOn(anchorCell, "getBoundingClientRect")
			.mockReturnValueOnce(createDomRect({ top: 20, width: 100, height: 100 }))
			.mockReturnValue(createDomRect({ top: 50, width: 100, height: 100 }));
		const hydratedCount = resolveItemCardModel.mock.calls.length;
		await rendered.rerender({
			documentIdentity: "first",
			sections: [
				{
					...section,
					items: [...section.items],
				},
			],
			applicationStore,
			linkContext,
			resolveItemCardModel,
		});
		await flushFrames();

		expect(
			root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
		).toHaveLength(4);
		expect(resolveItemCardModel).toHaveBeenCalledTimes(hydratedCount);
		expect(scroller.scrollTop).toBe(2_530);
		expect(anchorRect).toHaveBeenCalledTimes(2);
		expect(rectSpies.filter((rectSpy) => rectSpy !== anchorRect)).toSatisfy(
			(spies: typeof rectSpies) =>
				spies.every((rectSpy) => rectSpy.mock.calls.length === 0),
		);

		await rendered.rerender({
			documentIdentity: "second",
			sections: [section],
			applicationStore,
			linkContext,
			resolveItemCardModel,
		});
		await flushFrames();
		expect(
			root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
		).toHaveLength(2);
	});

	it("does not preserve an anchor below the viewport", async () => {
		const {
			anchorCell,
			applicationStore,
			linkContext,
			rendered,
			resolveItemCardModel,
			scroller,
			section,
		} = await renderAnchorTestSurface();
		const anchorRect = vi
			.spyOn(anchorCell, "getBoundingClientRect")
			.mockReturnValueOnce(createDomRect({ top: 300, width: 100, height: 100 }))
			.mockReturnValue(createDomRect({ top: 350, width: 100, height: 100 }));

		await rendered.rerender({
			documentIdentity: "anchor-test",
			sections: [
				{
					...section,
					items: [...section.items],
				},
			],
			applicationStore,
			linkContext,
			resolveItemCardModel,
		});
		await flushFrames();

		expect(scroller.scrollTop).toBe(2_500);
		expect(anchorRect).toHaveBeenCalledOnce();
	});

	it("does not preserve an anchor when scrollTop changes before restoration", async () => {
		const {
			anchorCell,
			applicationStore,
			linkContext,
			rendered,
			resolveItemCardModel,
			scroller,
			section,
		} = await renderAnchorTestSurface();
		const anchorRect = vi
			.spyOn(anchorCell, "getBoundingClientRect")
			.mockImplementationOnce(() => {
				queueMicrotask(() => setNumericProperty(scroller, "scrollTop", 2_600));
				return createDomRect({ top: 20, width: 100, height: 100 });
			})
			.mockReturnValue(createDomRect({ top: 50, width: 100, height: 100 }));

		await rendered.rerender({
			documentIdentity: "anchor-test",
			sections: [
				{
					...section,
					items: [...section.items],
				},
			],
			applicationStore,
			linkContext,
			resolveItemCardModel,
		});
		await flushFrames();

		expect(scroller.scrollTop).toBe(2_600);
		expect(anchorRect).toHaveBeenCalledOnce();
	});

	it("does not preserve an anchor when root width recovers from zero", async () => {
		const { anchorCell, root, scroller } = await renderAnchorTestSurface();
		const anchorRect = vi
			.spyOn(anchorCell, "getBoundingClientRect")
			.mockReturnValueOnce(createDomRect({ top: 20, width: 100, height: 100 }))
			.mockReturnValue(createDomRect({ top: 50, width: 100, height: 100 }));
		vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
			createDomRect({ top: 0, width: 320, height: 20_000 }),
		);

		triggerResize(root, 320, 20_000);
		await flushFrames();

		expect(scroller.scrollTop).toBe(2_500);
		expect(anchorRect).not.toHaveBeenCalled();
	});

	it("measures only root width and scroll viewport size changes", async () => {
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
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		document.body.append(scroller);
		const { container } = render(TwoHopProgressiveSurfaceHarness, {
			target: scroller,
			props: {
				sections: [createSection(300)],
				applicationStore,
				linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
				resolveItemCardModel: (
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
			},
		});
		const root = container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		const content = root?.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-content",
		);
		if (!root || !content) throw new Error("Progressive surface was not rendered");

		let rootWidth = 320;
		const rootRect = vi
			.spyOn(root, "getBoundingClientRect")
			.mockImplementation(() =>
				createDomRect({ top: 0, width: rootWidth, height: 20_000 }),
			);
		const contentRect = vi.spyOn(content, "getBoundingClientRect");
		const scrollerRect = vi.spyOn(scroller, "getBoundingClientRect");
		triggerResize(root, rootWidth, 20_000);
		rootRect.mockClear();
		contentRect.mockClear();
		scrollerRect.mockClear();

		const rootObserver = resizeObserverRecords.find((record) =>
			record.elements.has(root),
		);
		const scrollerObserver = resizeObserverRecords.find((record) =>
			record.elements.has(scroller),
		);
		expect(rootObserver?.elements.has(content)).toBe(false);
		expect(scrollerObserver).toBeDefined();

		triggerResize(root, rootWidth, 30_000);
		expect(rootRect).not.toHaveBeenCalled();
		expect(contentRect).not.toHaveBeenCalled();
		expect(scrollerRect).not.toHaveBeenCalled();

		rootWidth = 400;
		triggerResize(root, rootWidth, 30_000);
		expect(rootRect).toHaveBeenCalledOnce();
		expect(contentRect).not.toHaveBeenCalled();
		await flushFrames();
		rootRect.mockClear();
		contentRect.mockClear();
		scrollerRect.mockClear();

		triggerResize(scroller, 320, 300);
		expect(contentRect).not.toHaveBeenCalled();
		expect(scrollerRect).not.toHaveBeenCalled();

		setNumericProperty(scroller, "clientHeight", 400);
		triggerResize(scroller, 320, 400);
		await vi.waitFor(() => {
			expect(contentRect).toHaveBeenCalledOnce();
			expect(scrollerRect).toHaveBeenCalledOnce();
		});
		rootRect.mockClear();
		contentRect.mockClear();
		scrollerRect.mockClear();

		const sentinel = root.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-sentinel",
		);
		if (!sentinel) throw new Error("Progressive sentinel was not rendered");
		triggerIntersection(sentinel);
		await flushFrames();
		expect(rootRect).not.toHaveBeenCalled();
		expect(contentRect).not.toHaveBeenCalled();
		expect(scrollerRect).not.toHaveBeenCalled();
	});

	it("hydrates visible cards through post-paint while scrolling blocks idle work", async () => {
		const originalRequestIdleCallback = window.requestIdleCallback;
		const originalCancelIdleCallback = window.cancelIdleCallback;
		const requestIdleCallback = vi.fn(() => 41);
		window.requestIdleCallback = requestIdleCallback;
		window.cancelIdleCallback = vi.fn();
		const scrollSource = {};
		markScrollActivityActive(scrollSource);
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
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
				previewRequest: null,
			}),
		);
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		document.body.append(scroller);

		let unmount: (() => void) | undefined;
		try {
			const rendered = render(TwoHopProgressiveSurfaceHarness, {
				target: scroller,
				props: {
					sections: [createSection(100)],
					applicationStore,
					linkContext: {
						getPreview: vi.fn(),
					} as unknown as LinkContext,
					resolveItemCardModel,
				},
			});
			unmount = rendered.unmount;
			const { container } = rendered;
			const root = container.querySelector<HTMLElement>(
				".twohop-progressive-surface",
			);
			if (!root) throw new Error("Progressive surface was not rendered");
			setElementRect(root, { top: 0, width: 320, height: 20_000 });
			triggerResize(root, 320, 20_000);

			await flushFrames();
			await vi.waitFor(() => expect(resolveItemCardModel).toHaveBeenCalled());

			expect(requestIdleCallback).not.toHaveBeenCalled();
			expect(
				root.shadowRoot?.querySelectorAll(".twohop-card-shell").length,
			).toBeLessThan(100);
		} finally {
			unmount?.();
			markScrollActivityIdle(scrollSource);
			window.requestIdleCallback = originalRequestIdleCallback;
			window.cancelIdleCallback = originalCancelIdleCallback;
		}
	});

	it("hydrates lazily, appends one chunk, and coalesces ordinary scroll events", async () => {
		const targetFile = {
			path: "notes/preview.md",
			basename: "preview",
			extension: "md",
			parent: { path: "notes" },
			stat: { mtime: 1 },
		} as TFile;
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
		const linkContext = {
			getPreview: vi.fn(),
			sourceFile: targetFile,
			fileToLinktext: () => "preview",
			getMetadata: () => null,
		} as unknown as LinkContext;
		const resolveItemCardModel = vi.fn(
			(item: TwoHopItemModel, presentation): CardRenderModel => ({
				item: item.item,
				targetFile,
				title: item.key,
				ariaLabel: item.key,
				className: null,
				extension: "md",
				directory: "notes",
				interactionId: item.interactionId ?? item.key,
				interactionKey: item.interactionId ?? item.key,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: compileCardPreviewRequest({
					file: targetFile,
					searchQuery: "",
					previewRefreshToken: 0,
					previewOverride: null,
					previewRenderVersion: `preview:${item.key}`,
					settings: DEFAULT_SETTINGS,
				}),
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
				sections: [createSection(300)],
				applicationStore,
				linkContext,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		if (!root) throw new Error("Progressive surface was not rendered");

		expect(resolveItemCardModel).not.toHaveBeenCalled();
		expect(
			root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
		).toHaveLength(2);

		setElementRect(root, { top: 0, width: 320, height: 20_000 });
		triggerResize(root, 320, 20_000);
		await flushFrames();
		await vi.waitFor(() => expect(resolveItemCardModel).toHaveBeenCalled());
		await waitForCardHydrationToSettle(resolveItemCardModel);
		const hydratedCount = resolveItemCardModel.mock.calls.length;
		const chunkCount = root.shadowRoot?.querySelectorAll(
			".twohop-progressive-chunk",
		).length;

		for (let index = 0; index < 100; index += 1) {
			await fireEvent.scroll(scroller);
		}
		await flushFrames();
		expect(resolveItemCardModel).toHaveBeenCalledTimes(hydratedCount);
		expect(
			root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
		).toHaveLength(chunkCount ?? 0);

		const sentinel = root.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-sentinel",
		);
		if (!sentinel) throw new Error("Progressive sentinel was not rendered");
		triggerIntersection(sentinel);
		await flushFrames();
		expect(
			root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
		).toHaveLength((chunkCount ?? 0) + 1);

		expect(
			root.shadowRoot?.querySelectorAll("[data-preview-owner='virtual-surface']"),
		).toHaveLength(0);
		const rows = root.shadowRoot?.querySelectorAll(".twohop-progressive-row") ?? [];
		expect(
			intersectionObserverRecords.every((record) =>
				[...rows].every((row) => !record.elements.has(row)),
			),
		).toBe(true);
	});

	it("mounts and focuses the next chunk when ArrowDown reaches the mounted boundary", async () => {
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 1,
			},
		} as unknown as ApplicationStore;
		const resolveItemCardModel = createCardModelResolver();
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientWidth", 100);
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setNumericProperty(scroller, "scrollTop", 3_300);
		setElementRect(scroller, { top: 0, width: 100, height: 300 });
		document.body.append(scroller);
		const { container } = render(TwoHopProgressiveSurfaceHarness, {
			target: scroller,
			props: {
				sections: [createSection(80)],
				applicationStore,
				linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		const content = root?.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-content",
		);
		if (!root || !content) {
			throw new Error("Progressive surface was not rendered");
		}
		setElementRect(root, { top: -3_300, width: 100, height: 20_000 });
		setElementRect(content, { top: -3_300, width: 100, height: 20_000 });
		triggerResize(root, 100, 20_000);
		triggerResize(scroller, 100, 300);
		await fireEvent.scroll(scroller);
		await flushFrames();

		const currentCell = root.shadowRoot?.querySelector<HTMLElement>(
			"[data-ccl-row-index='31'][data-ccl-column-index='0']",
		);
		if (!currentCell) throw new Error("Mounted boundary cell was not rendered");
		await vi.waitFor(() =>
			expect(currentCell.querySelector(RESULT_FOCUS_SELECTOR)).not.toBeNull(),
		);
		const currentTarget =
			currentCell.querySelector<HTMLElement>(RESULT_FOCUS_SELECTOR);
		if (!currentTarget) throw new Error("Mounted boundary card was not hydrated");
		currentTarget.focus();

		await fireEvent.keyDown(currentTarget, { key: "ArrowDown" });
		await vi.waitFor(() => {
			expect(
				root.shadowRoot?.querySelectorAll(".twohop-progressive-chunk"),
			).toHaveLength(3);
			const targetCell = root.shadowRoot?.querySelector<HTMLElement>(
				"[data-ccl-row-index='32'][data-ccl-column-index='0']",
			);
			expect(targetCell?.contains(root.shadowRoot?.activeElement ?? null)).toBe(
				true,
			);
		});
	});

	it("creates and replaces the preview surface when dependencies change", async () => {
		const targetFile = {
			path: "notes/preview.md",
			basename: "preview",
			extension: "md",
			parent: { path: "notes" },
			stat: { mtime: 1 },
		} as TFile;
		const applicationStore = {
			settings: {
				...DEFAULT_SETTINGS,
				cardWidthPx: 100,
				cardHeightRatio: 1,
				cardMaxColumns: 3,
			},
		} as unknown as ApplicationStore;
		const firstProbe = createPreviewSurfaceProbe();
		const secondProbe = createPreviewSurfaceProbe();
		const firstCreateSurface = vi.fn(() => firstProbe.surface);
		const secondCreateSurface = vi.fn(() => secondProbe.surface);
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
		const commonProps = {
			sections: [createSection(100)],
			applicationStore,
			linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
			resolveItemCardModel,
		};
		const rendered = render(TwoHopProgressiveSurfaceHarness, {
			target: scroller,
			props: commonProps,
		});
		const root = rendered.container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		if (!root) throw new Error("Progressive surface was not rendered");
		setElementRect(root, { top: 0, width: 320, height: 20_000 });
		triggerResize(root, 320, 20_000);
		await flushFrames();

		expect(
			root.shadowRoot?.querySelectorAll("[data-preview-owner='virtual-surface']"),
		).toHaveLength(0);

		await rendered.rerender({
			...commonProps,
			previewDependencies: {
				previewRuntime: { createSurface: firstCreateSurface },
				resolveSearchMatchPosition: () => undefined,
			} as unknown as TwoHopPreviewDependencies,
		});
		await flushFrames();
		await vi.waitFor(() =>
			expect(firstProbe.surface.registerHost).toHaveBeenCalled(),
		);

		await rendered.rerender({
			...commonProps,
			previewDependencies: {
				previewRuntime: { createSurface: secondCreateSurface },
				resolveSearchMatchPosition: () => undefined,
			} as unknown as TwoHopPreviewDependencies,
		});
		await flushFrames();
		await vi.waitFor(() =>
			expect(secondProbe.surface.registerHost).toHaveBeenCalled(),
		);

		expect(firstCreateSurface).toHaveBeenCalledOnce();
		expect(firstProbe.surface.dispose).toHaveBeenCalledOnce();
		expect(secondCreateSurface).toHaveBeenCalledOnce();

		await rendered.rerender({
			...commonProps,
			previewDependencies: undefined,
		});
		await flushFrames();
		await vi.waitFor(() => {
			expect(secondProbe.surface.dispose).toHaveBeenCalledOnce();
			expect(
				root.shadowRoot?.querySelectorAll(
					"[data-preview-owner='virtual-surface']",
				),
			).toHaveLength(0);
		});
	});

	it("remeasures preview geometry after inline sizer movement", async () => {
		const surfaceProbe = createPreviewSurfaceProbe();
		const previewDependencies = {
			previewRuntime: {
				createSurface: () => surfaceProbe.surface,
			},
			resolveSearchMatchPosition: () => undefined,
		} as unknown as TwoHopPreviewDependencies;
		const targetFile = {
			path: "notes/preview.md",
			basename: "preview",
			extension: "md",
			parent: { path: "notes" },
			stat: { mtime: 1 },
		} as TFile;
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
				renderKey: `preview:${item.key}`,
			} as CardPreviewRequest,
		});
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientHeight", 300);
		setNumericProperty(scroller, "scrollHeight", 20_000);
		setElementRect(scroller, { top: 0, width: 320, height: 300 });
		scroller.classList.add("cm-scroller", "ccl-inline-card-host");
		document.body.append(scroller);
		const sizer = document.createElement("div");
		sizer.classList.add("cm-sizer");
		const surfaceContainer = document.createElement("div");
		scroller.append(sizer, surfaceContainer);
		const props = {
			sections: [createSection(100)],
			applicationStore,
			linkContext: { getPreview: vi.fn() } as unknown as LinkContext,
			previewDependencies,
			resolveItemCardModel,
		};
		const rendered = render(TwoHopProgressiveSurfaceHarness, {
			target: surfaceContainer,
			props,
		});
		const root = rendered.container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		const content = root?.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-content",
		);
		if (!root || !content) throw new Error("Progressive surface was not rendered");
		setElementRect(content, { top: 0, width: 320, height: 20_000 });

		await flushFrames();
		await vi.waitFor(() =>
			expect(
				root.shadowRoot?.querySelectorAll(
					"[data-preview-owner='virtual-surface']",
				).length,
			).toBeGreaterThan(0),
		);

		setElementRect(content, { top: 1_000, width: 320, height: 20_000 });
		triggerResize(sizer, 320, 1_000);
		await flushFrames();
		await vi.waitFor(() =>
			expect(
				root.shadowRoot?.querySelectorAll(
					"[data-preview-owner='virtual-surface']",
				),
			).toHaveLength(0),
		);

		setElementRect(content, { top: 0, width: 320, height: 20_000 });
		triggerResize(sizer, 320, 0);
		await flushFrames();
		await vi.waitFor(() =>
			expect(
				root.shadowRoot?.querySelectorAll(
					"[data-preview-owner='virtual-surface']",
				).length,
			).toBeGreaterThan(0),
		);
	});

	it("leaves newly mounted offscreen chunks unhydrated and coalesces scroll range changes", async () => {
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
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
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
				previewRequest: {
					renderKey: `preview:${item.key}`,
				} as CardPreviewRequest,
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
				sections: [createSection(100)],
				applicationStore,
				linkContext,
				previewDependencies,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(
			".twohop-progressive-surface",
		);
		if (!root) throw new Error("Progressive surface was not rendered");
		await flushFrames();
		await vi.waitFor(() => {
			const frame = publish.mock.lastCall?.[0] as PreviewFrame | undefined;
			expect(frame?.previewBindingsBySlot.size).toBeGreaterThan(0);
		});
		await waitForCardHydrationToSettle(resolveItemCardModel);
		const initialFrame = publish.mock.lastCall?.[0] as PreviewFrame | undefined;
		if (!initialFrame) throw new Error("Initial preview frame was not published");
		publish.mockClear();
		const sentinel = root.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-sentinel",
		);
		if (!sentinel) throw new Error("Progressive sentinel was not rendered");
		triggerIntersection(sentinel);
		await flushFrames();
		const appendedChunk = [
			...(root.shadowRoot?.querySelectorAll<HTMLElement>(
				".twohop-progressive-chunk",
			) ?? []),
		].at(-1);
		if (!appendedChunk) throw new Error("Progressive chunk was not appended");
		const hydratedCountBeforeOffscreenChunk =
			resolveItemCardModel.mock.calls.length;
		publish.mockClear();
		await flushFrames();
		expect(resolveItemCardModel).toHaveBeenCalledTimes(
			hydratedCountBeforeOffscreenChunk,
		);
		expect(publish).not.toHaveBeenCalled();

		const allRows = [
			...(root.shadowRoot?.querySelectorAll<HTMLElement>(
				".twohop-progressive-row",
			) ?? []),
		];
		expect(
			intersectionObserverRecords.every((record) =>
				allRows.every((row) => !record.elements.has(row)),
			),
		).toBe(true);
		const previewScrollTarget = findNearestScrollContainer(root) ?? window;
		const dispatchScroll = (scrollTop: number): void => {
			setNumericProperty(previewScrollTarget, "scrollTop", scrollTop);
			if (previewScrollTarget === window) {
				setNumericProperty(window, "scrollY", scrollTop);
			}
			previewScrollTarget.dispatchEvent(new Event("scroll"));
		};
		dispatchScroll(350);
		dispatchScroll(400);
		dispatchScroll(450);
		expect(publish).not.toHaveBeenCalled();
		expect(isScrollActivityActive()).toBe(true);
		await vi.waitFor(() => expect(publish).toHaveBeenCalled());
		const scrolledFrame = publish.mock.lastCall?.[0] as PreviewFrame;
		expect(scrolledFrame.previewWindow.previewRange.start).toBeGreaterThan(
			initialFrame.previewWindow.previewRange.start,
		);
		let preservedBindingCount = 0;
		for (const [slotId, binding] of initialFrame.previewBindingsBySlot) {
			if (!scrolledFrame.previewBindingsBySlot.has(slotId)) continue;
			expect(scrolledFrame.previewBindingsBySlot.get(slotId)).toBe(binding);
			preservedBindingCount += 1;
		}
		expect(preservedBindingCount).toBeGreaterThan(0);
		await vi.waitFor(() => expect(isScrollActivityActive()).toBe(false));
	});
});
