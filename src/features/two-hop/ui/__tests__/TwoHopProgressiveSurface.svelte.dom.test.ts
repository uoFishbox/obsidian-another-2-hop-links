import { fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import { compileCardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import type { TFile } from "obsidian";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type { PreviewFrame } from "features/preview/scheduling/virtualPreviewSurface";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";
import { findNearestScrollContainer } from "ui/virtualization/dom/scrollContainer";
import {
	isScrollActivityActive,
	resetScrollActivityForTests,
} from "ui/virtualization/scheduling/scrollActivity";
import {
	flushFrames,
	intersectionObserverRecords,
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
			(item: TwoHopVirtualListItem, presentation): CardRenderModel => ({
				item: item.item,
				targetFile,
				title: item.virtualKey,
				ariaLabel: item.virtualKey,
				className: null,
				extension: "md",
				directory: "notes",
				interactionId: item.interactionId ?? item.virtualKey,
				interactionKey: item.interactionId ?? item.virtualKey,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: compileCardPreviewRequest({
					file: targetFile,
					searchQuery: "",
					previewRefreshToken: 0,
					previewOverride: null,
					previewRenderVersion: `preview:${item.virtualKey}`,
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
		expect(resolveItemCardModel).toHaveBeenCalled();
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
			root.shadowRoot?.querySelectorAll("[data-preview-owner='virtual-surface']")
				.length,
		).toBeGreaterThan(0);
		const rows = root.shadowRoot?.querySelectorAll(".twohop-progressive-row") ?? [];
		expect(
			intersectionObserverRecords.every((record) =>
				[...rows].every((row) => !record.elements.has(row)),
			),
		).toBe(true);
	});

	it("skips offscreen hydration publications and publishes one range per scroll frame", async () => {
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
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
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
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: {
					renderKey: `preview:${item.virtualKey}`,
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
		triggerIntersection(appendedChunk);
		await flushFrames();
		expect(resolveItemCardModel.mock.calls.length).toBeGreaterThan(
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
		await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
		const scrolledFrame = publish.mock.calls[0]?.[0] as PreviewFrame;
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
