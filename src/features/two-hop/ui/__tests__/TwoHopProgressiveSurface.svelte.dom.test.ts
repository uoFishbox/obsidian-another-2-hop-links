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
import {
	flushFrames,
	createDomRect,
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
	installResizeObserverMock();
	installIntersectionObserverMock();
});

afterEach(() => {
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
});

describe("TwoHopProgressiveSurface", () => {
	it("hydrates lazily, appends one chunk, and does no work for ordinary scroll events", async () => {
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
				twoHopListMode: "progressive-chunks",
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
			root.shadowRoot?.querySelectorAll("[data-preview-owner='virtual-surface']"),
		).toHaveLength(0);
		const firstRow = root.shadowRoot?.querySelector<HTMLElement>(
			".twohop-progressive-row",
		);
		if (!firstRow) throw new Error("Progressive row was not rendered");
		triggerIntersection(firstRow);
		await flushFrames();
		expect(
			root.shadowRoot?.querySelectorAll("[data-preview-owner='virtual-surface']")
				.length,
		).toBeGreaterThan(0);
	});

	it("skips offscreen hydration publications and coalesces preview row intersections", async () => {
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
		const { container } = render(TwoHopProgressiveSurfaceHarness, {
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
		const rows = allRows.slice(0, 4);
		const previewObserver = intersectionObserverRecords.find((record) =>
			rows.some((row) => record.elements.has(row)),
		);
		if (!previewObserver) throw new Error("Preview row observer was not installed");
		const createIntersectionEntry = (row: HTMLElement): IntersectionObserverEntry =>
			({
				target: row,
				isIntersecting: true,
				intersectionRatio: 1,
				boundingClientRect: createDomRect({
					top: 0,
					width: 100,
					height: 100,
				}),
				intersectionRect: createDomRect({
					top: 0,
					width: 100,
					height: 100,
				}),
				rootBounds: null,
				time: 0,
			}) as IntersectionObserverEntry;

		previewObserver.callback(
			rows.map(createIntersectionEntry),
			{} as IntersectionObserver,
		);

		expect(publish).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(publish).toHaveBeenCalledOnce();
		const firstFrame = publish.mock.calls[0]?.[0] as PreviewFrame;
		expect(firstFrame.previewBindingsBySlot.size).toBeGreaterThan(0);
		publish.mockClear();
		const adjacentRow = allRows[4];
		if (!adjacentRow) throw new Error("Adjacent progressive row was not rendered");

		previewObserver.callback(
			[createIntersectionEntry(adjacentRow)],
			{} as IntersectionObserver,
		);
		await Promise.resolve();

		expect(publish).toHaveBeenCalledOnce();
		const secondFrame = publish.mock.calls[0]?.[0] as PreviewFrame;
		for (const [slotId, binding] of firstFrame.previewBindingsBySlot) {
			expect(secondFrame.previewBindingsBySlot.get(slotId)).toBe(binding);
		}
	});
});
