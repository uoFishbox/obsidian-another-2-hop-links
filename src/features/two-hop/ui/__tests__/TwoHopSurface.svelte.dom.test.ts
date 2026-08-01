import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "features/settings/model";
import { compileCardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import TwoHopSurface from "features/two-hop/ui/TwoHopSurface.svelte";
import TwoHopSurfaceModelHarness from "./TwoHopSurfaceModelHarness.svelte";
import {
	flushFrames,
	installAnimationFrameMock,
	installIntersectionObserverMock,
	installResizeObserverMock,
	resetRecords,
	setElementRect,
	setNumericProperty,
	teardownAnimationFrameMock,
	teardownIntersectionObserverMock,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";
import type { CardRenderModel } from "ui/components/items/cardRenderModel";
import type { LinkContext } from "ui/context/linkContext";
import type { App, TFile } from "obsidian";
import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
import type { CardPreviewLoader } from "features/preview/ui/cardPreviewRenderer";
import {
	createPreviewRuntime,
	type PreviewRuntime,
} from "features/preview/runtime/previewRuntime";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";

const previewSurfaceCalls = vi.hoisted(() => ({
	create: vi.fn(),
	publish: vi.fn(),
}));
const previewRuntimes = new Set<PreviewRuntime>();

vi.mock("features/preview/scheduling/virtualPreviewSurface", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("features/preview/scheduling/virtualPreviewSurface")
		>();
	return {
		...actual,
		createVirtualPreviewSurface: (
			...args: Parameters<typeof actual.createVirtualPreviewSurface>
		) => {
			previewSurfaceCalls.create(...args);
			const surface = actual.createVirtualPreviewSurface(...args);
			return {
				...surface,
				publish: (...frameArgs: Parameters<typeof surface.publish>) => {
					previewSurfaceCalls.publish(...frameArgs);
					surface.publish(...frameArgs);
				},
			};
		},
	};
});

beforeEach(() => {
	previewSurfaceCalls.create.mockClear();
	previewSurfaceCalls.publish.mockClear();
	resetRecords();
	installResizeObserverMock();
	installIntersectionObserverMock();
	installAnimationFrameMock();
});

afterEach(() => {
	cleanup();
	for (const runtime of previewRuntimes) runtime.dispose();
	previewRuntimes.clear();
	teardownResizeObserverMock();
	teardownIntersectionObserverMock();
	teardownAnimationFrameMock();
});

function createSection(
	count: number,
	options: {
		readonly revision?: number;
		readonly contentSuffix?: string;
	} = {},
): TwoHopVirtualSectionDescriptor {
	const contentSuffix = options.contentSuffix ?? "";
	const items = Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}${contentSuffix}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	return {
		sourceRevision: createSectionDataRevision(options.revision ?? 1),
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

const applicationStore = {
	settings: {
		...DEFAULT_SETTINGS,
		cardWidthPx: 100,
		cardHeightRatio: 1,
		cardMaxColumns: 3,
	},
} as unknown as ApplicationStore;

function createPreviewDependencies(
	getPreview: CardPreviewLoader = vi.fn(async () => ({
		type: "empty" as const,
		content: "",
	})),
): TwoHopPreviewDependencies {
	const app = { vault: {} } as App;
	const previewRuntime = createPreviewRuntime({ app, getPreview });
	previewRuntimes.add(previewRuntime);
	return {
		previewRuntime,
		resolveSearchMatchPosition: () => undefined,
	};
}

async function renderScrollableSurface(
	count: number,
	previewDependencies?: TwoHopPreviewDependencies,
): Promise<{
	root: HTMLElement;
	scroller: HTMLElement;
}> {
	const scroller = document.createElement("div");
	scroller.style.overflow = "auto";
	setNumericProperty(scroller, "clientHeight", 120);
	setNumericProperty(scroller, "scrollHeight", 10_000);
	setNumericProperty(scroller, "scrollTop", 0);
	setElementRect(scroller, { top: 0, width: 330, height: 120 });
	document.body.append(scroller);

	render(TwoHopSurface, {
		target: scroller,
		props: {
			sections: [createSection(count)],
			applicationStore,
			initialVisibleCount: count,
			previewDependencies,
		},
	});
	const root = scroller.querySelector<HTMLElement>(".twohop-keyed-surface");
	if (!root) {
		throw new Error("Two-hop virtual surface was not rendered");
	}

	setElementRect(root, { top: 0, width: 330, height: 10_000 });
	triggerResize(root, 330, 10_000);
	triggerResize(scroller, 330, 120);
	await flushFrames();

	return { root, scroller };
}

function getPhysicalSlot(root: HTMLElement, slot: number): HTMLElement | null {
	return (
		root.shadowRoot?.querySelector<HTMLElement>(`[data-ccl-cell-slot='${slot}']`) ??
		null
	);
}

function getRowsByPhysicalSlot(root: HTMLElement): Map<string, string> {
	const rows = root.shadowRoot?.querySelectorAll<HTMLElement>("[data-ccl-row-slot]");
	return new Map(
		[...(rows ?? [])].map((row) => [
			row.dataset.cclRowSlot ?? "",
			row.dataset.cclRowIndex ?? "",
		]),
	);
}

async function scrollSurface(
	root: HTMLElement,
	scroller: HTMLElement,
	scrollTop: number,
): Promise<void> {
	setNumericProperty(scroller, "scrollTop", scrollTop);
	setElementRect(root, {
		top: -scrollTop,
		width: 330,
		height: 10_000,
	});
	await fireEvent.scroll(scroller);
	await flushFrames();
}

describe("TwoHopSurface", () => {
	it("publishes binding changes through one immutable preview frame", async () => {
		const { root, scroller } = await renderScrollableSurface(
			100,
			createPreviewDependencies(),
		);
		previewSurfaceCalls.publish.mockClear();

		await scrollSurface(root, scroller, 600);

		expect(previewSurfaceCalls.publish).toHaveBeenCalled();
		for (const [frame] of previewSurfaceCalls.publish.mock.calls) {
			expect(frame.previewWindow.previewRange.start).toBeGreaterThan(0);
		}
	});

	it("reevaluates only changed physical rows when the mounted range shifts", async () => {
		const { root, scroller } = await renderScrollableSurface(100);
		let previousRows = getRowsByPhysicalSlot(root);
		let verifiedRangeShift = false;

		for (let scrollTop = 20; scrollTop <= 1_000; scrollTop += 20) {
			resetCCLDevMeasurements();
			await scrollSurface(root, scroller, scrollTop);
			const nextRows = getRowsByPhysicalSlot(root);
			const changedSlots = new Set([...previousRows.keys(), ...nextRows.keys()])
				.size;
			let changedSlotCount = 0;
			for (const slot of new Set([...previousRows.keys(), ...nextRows.keys()])) {
				if (previousRows.get(slot) !== nextRows.get(slot)) {
					changedSlotCount += 1;
				}
			}

			if (changedSlotCount > 0 && changedSlots === previousRows.size) {
				const reevaluations =
					getCCLDevMeasurementSnapshot().counters[
						"component.ViewItemCard.reevaluate"
					].count;
				expect(reevaluations).toBeLessThanOrEqual(
					applicationStore.settings.cardMaxColumns * changedSlotCount,
				);
				verifiedRangeShift = true;
				break;
			}
			previousRows = nextRows;
		}

		expect(verifiedRangeShift).toBe(true);
	});

	it("commits two-hop preview DOM without reevaluating ViewItemCard", async () => {
		const targetFile = {
			path: "notes/preview.md",
			basename: "preview",
			extension: "md",
			parent: { path: "notes" },
			stat: { mtime: 1 },
		} as TFile;
		const getPreview = vi.fn(async () => ({
			type: "image" as const,
			content: "https://example.com/preview.png",
		}));
		const linkContext = {
			getPreview,
			sourceFile: targetFile,
			fileToLinktext: () => "preview",
			getMetadata: () => null,
		} as unknown as LinkContext;
		const previewDependencies = createPreviewDependencies(getPreview);
		const resolveItemCardModel = vi.fn(
			(
				item: TwoHopVirtualListItem,
				presentation: CardRenderModel["presentation"],
			): CardRenderModel => ({
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
		resetCCLDevMeasurements();
		const harnessProps = {
			sections: [createSection(1)],
			applicationStore,
			linkContext,
			previewDependencies,
			previewActive: false,
			resolveItemCardModel,
		};
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientHeight", 120);
		setNumericProperty(scroller, "scrollHeight", 10_000);
		setNumericProperty(scroller, "scrollTop", 0);
		setElementRect(scroller, { top: 0, width: 330, height: 120 });
		document.body.append(scroller);
		const { rerender } = render(TwoHopSurfaceModelHarness, {
			target: scroller,
			props: harnessProps,
		});
		const root = scroller.querySelector<HTMLElement>(".twohop-keyed-surface");
		if (!root) {
			throw new Error("Two-hop virtual surface was not rendered");
		}
		setElementRect(root, { top: 0, width: 330, height: 10_000 });
		triggerResize(root, 330, 10_000);
		triggerResize(scroller, 330, 120);

		for (let index = 0; index < 6; index += 1) {
			await flushFrames();
			await Promise.resolve();
		}
		const host = root.shadowRoot?.querySelector<HTMLElement>(
			'[data-preview-owner="virtual-surface"]',
		);
		expect(host).not.toBeNull();
		expect(getPreview).not.toHaveBeenCalled();

		previewSurfaceCalls.publish.mockClear();
		await rerender({
			...harnessProps,
			previewActive: true,
		});
		const reevaluationsBefore =
			getCCLDevMeasurementSnapshot().counters["component.ViewItemCard.reevaluate"]
				.count;
		await waitFor(() => expect(getPreview).toHaveBeenCalled());
		for (let index = 0; index < 4; index += 1) {
			await flushFrames();
			await Promise.resolve();
		}

		await waitFor(() => expect(host?.dataset.previewState).toBe("committed"));
		expect(host?.querySelector("img")).not.toBeNull();
		expect(previewSurfaceCalls.publish).toHaveBeenCalled();
		expect(
			previewSurfaceCalls.publish.mock.calls.at(-1)?.[0].previewWindow.active,
		).toBe(true);
		expect(
			getCCLDevMeasurementSnapshot().counters["component.ViewItemCard.reevaluate"]
				.count,
		).toBe(reevaluationsBefore);
	});

	it("does not create preview runtime when preview dependencies are omitted", () => {
		render(TwoHopSurface, {
			props: {
				sections: [createSection(1)],
				applicationStore,
			},
		});

		expect(previewSurfaceCalls.create).not.toHaveBeenCalled();
	});

	it("shares each resolved card model with the rendered slot", () => {
		const resolveItemCardModel = vi.fn(
			(item: TwoHopVirtualListItem, presentation): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.virtualKey,
				ariaLabel: item.virtualKey,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.interactionId ?? item.virtualKey,
				interactionKey: item.interactionId ?? item.virtualKey,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: null,
			}),
		);
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
		const { container } = render(TwoHopSurfaceModelHarness, {
			props: {
				sections: [createSection(6)],
				applicationStore,
				linkContext,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(".twohop-keyed-surface");
		const renderedCards = root?.shadowRoot?.querySelectorAll(
			"[data-testid='twohop-item-cell']",
		).length;

		expect(renderedCards).toBeGreaterThan(0);
		expect(resolveItemCardModel).toHaveBeenCalledTimes(renderedCards ?? 0);
	});

	it("refreshes a same-key card when its section publication changes", async () => {
		const resolveItemCardModel = vi.fn(
			(item: TwoHopVirtualListItem, presentation): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: item.searchKey,
				ariaLabel: item.searchKey,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.interactionId ?? item.virtualKey,
				interactionKey: item.interactionId ?? item.virtualKey,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: null,
			}),
		);
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
		const baseProps = {
			applicationStore,
			linkContext,
			resolveItemCardModel,
		};
		const { container, rerender } = render(TwoHopSurfaceModelHarness, {
			props: {
				...baseProps,
				sections: [
					createSection(1, { revision: 1, contentSuffix: ":initial" }),
				],
			},
		});
		const resolveSurfaceText = (): string =>
			container.querySelector<HTMLElement>(".twohop-keyed-surface")?.shadowRoot
				?.textContent ?? "";
		await waitFor(() => expect(resolveSurfaceText()).toContain("item:0:initial"));
		const callsBeforeRefresh = resolveItemCardModel.mock.calls.length;

		await rerender({
			...baseProps,
			sections: [createSection(1, { revision: 2, contentSuffix: ":refreshed" })],
		});

		await waitFor(() => expect(resolveSurfaceText()).toContain("item:0:refreshed"));
		expect(resolveSurfaceText()).not.toContain("item:0:initial");
		expect(resolveItemCardModel.mock.calls.length).toBeGreaterThan(
			callsBeforeRefresh,
		);
	});

	it.each([100, 1_000, 10_000])(
		"mounts %i logical cards with a bounded fixed pool",
		(cardCount) => {
			const { container } = render(TwoHopSurface, {
				props: {
					sections: [createSection(cardCount)],
					applicationStore,
					initialVisibleCount: 10_000,
				},
			});
			const root = container.querySelector<HTMLElement>(".twohop-keyed-surface");
			const cells = root?.shadowRoot?.querySelectorAll(
				".view-plan-virtual-list-cell",
			);

			expect(root?.shadowRoot).not.toBeNull();
			expect(cells?.length).toBeGreaterThan(0);
			expect(cells?.length).toBeLessThan(100);
			expect(
				root?.shadowRoot?.querySelectorAll("[data-testid='twohop-item-cell']")
					.length,
			).toBeGreaterThan(0);
		},
	);

	it.each([1, 8, 32])(
		"keeps %i surfaces on separate scrollers independently bounded",
		(count) => {
			const roots: HTMLElement[] = [];
			const scrollers: HTMLElement[] = [];
			for (let index = 0; index < count; index += 1) {
				const scroller = document.createElement("div");
				scroller.style.overflow = "auto";
				Object.defineProperty(scroller, "clientHeight", { value: 300 });
				Object.defineProperty(scroller, "scrollHeight", { value: 10_000 });
				document.body.append(scroller);
				scrollers.push(scroller);
				render(TwoHopSurface, {
					target: scroller,
					props: {
						sections: [createSection(100)],
						applicationStore,
						initialVisibleCount: 100,
					},
				});
				const root = scroller.querySelector<HTMLElement>(
					".twohop-keyed-surface",
				);
				if (root) roots.push(root);
			}

			expect(roots).toHaveLength(count);
			for (const root of roots) {
				expect(
					root.shadowRoot?.querySelectorAll(".view-plan-virtual-list-cell")
						.length,
				).toBeLessThan(100);
			}
			for (const scroller of scrollers) scroller.remove();
		},
	);

	it("updates pooled cells while scrolling an external observer root", async () => {
		const { root, scroller } = await renderScrollableSurface(100);
		const initialSlot = getPhysicalSlot(root, 1);
		const initialBody = initialSlot?.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);
		const initialKey = initialSlot?.dataset.cclLogicalKey;
		const initialRowIndex = initialSlot?.dataset.cclRowIndex;

		expect(initialBody?.textContent).toContain("item:0");
		expect(initialKey).toContain("item:0");
		if (!initialBody) {
			throw new Error("Initial item body was not rendered");
		}
		initialBody.tabIndex = 0;
		initialBody.dataset.cclHovered = "true";
		initialBody.dataset.cclLongPressed = "1";
		initialBody.focus();
		expect(root.shadowRoot?.activeElement).toBe(initialBody);

		await scrollSurface(root, scroller, 804);
		await waitFor(() => {
			expect(getPhysicalSlot(root, 1)?.dataset.cclLogicalKey).not.toBe(
				initialKey,
			);
		});

		const updatedSlot = getPhysicalSlot(root, 1);
		const updatedBody = updatedSlot?.querySelector<HTMLElement>(
			".cosense-card-links__box",
		);
		expect(updatedBody).toBe(initialBody);
		expect(updatedBody?.textContent).not.toContain("item:0");
		expect(updatedSlot?.dataset.cclRowIndex).not.toBe(initialRowIndex);
		expect(root.shadowRoot?.activeElement).not.toBe(updatedBody);
		expect(updatedBody?.dataset.cclHovered).toBeUndefined();
		expect(updatedBody?.dataset.cclLongPressed).toBeUndefined();
	});

	it("remounts a load-more body as the newly revealed logical card", async () => {
		const resolveItemCardModel = vi.fn(
			(item: TwoHopVirtualListItem, presentation): CardRenderModel => ({
				item: item.item,
				targetFile: null,
				title: `resolved:${item.searchKey}`,
				ariaLabel: `resolved:${item.searchKey}`,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.interactionId ?? item.virtualKey,
				interactionKey: item.interactionId ?? item.virtualKey,
				interactionDescriptor: null,
				presentation,
				searchQuery: "",
				previewRequest: null,
			}),
		);
		const linkContext = {
			getPreview: vi.fn(),
		} as unknown as LinkContext;
		const { container } = render(TwoHopSurfaceModelHarness, {
			props: {
				sections: [createSection(10)],
				applicationStore,
				linkContext,
				initialVisibleCount: 1,
				loadMoreIncrement: 2,
				resolveItemCardModel,
			},
		});
		const root = container.querySelector<HTMLElement>(".twohop-keyed-surface");
		const loadMoreCell = root?.shadowRoot?.querySelector<HTMLElement>(
			"[data-testid='load-more-section']",
		);
		const loadMoreButton = loadMoreCell?.querySelector<HTMLButtonElement>(
			".cosense-card-links__load-more-button",
		);

		expect(loadMoreCell).not.toBeNull();
		expect(loadMoreButton).not.toBeNull();
		await fireEvent.click(loadMoreButton!);

		await waitFor(() => {
			expect(loadMoreCell?.dataset.testid).toBe("twohop-item-cell");
		});
		expect(
			loadMoreCell?.querySelector(".cosense-card-links__load-more-button"),
		).toBeNull();
		const itemBody = loadMoreCell?.querySelector(".cosense-card-links__box");
		expect(itemBody).not.toBe(loadMoreButton);
		expect(itemBody?.textContent).toContain("resolved:item:1");
		expect(
			resolveItemCardModel.mock.calls.some(
				([item]) => item.virtualKey === "item:1",
			),
		).toBe(true);
	});

	it("applies changed pagination settings without remounting the surface", async () => {
		const baseProps = {
			sections: [createSection(20)],
			applicationStore,
		};
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		setNumericProperty(scroller, "clientHeight", 10_000);
		setNumericProperty(scroller, "scrollHeight", 10_000);
		setNumericProperty(scroller, "scrollTop", 0);
		setElementRect(scroller, { top: 0, width: 330, height: 10_000 });
		document.body.append(scroller);
		const { rerender } = render(TwoHopSurface, {
			target: scroller,
			props: {
				...baseProps,
				initialVisibleCount: 1,
				loadMoreIncrement: 2,
			},
		});
		const root = scroller.querySelector<HTMLElement>(".twohop-keyed-surface");
		if (!root) {
			throw new Error("Two-hop virtual surface was not rendered");
		}
		setElementRect(root, { top: 0, width: 330, height: 10_000 });
		triggerResize(root, 330, 10_000);
		triggerResize(scroller, 330, 10_000);
		await flushFrames();
		const getRenderedItemCount = (): number =>
			root.shadowRoot?.querySelectorAll("[data-testid='twohop-item-cell']")
				.length ?? 0;

		expect(getRenderedItemCount()).toBe(1);

		await rerender({
			...baseProps,
			initialVisibleCount: 3,
			loadMoreIncrement: 4,
		});
		await waitFor(() => expect(getRenderedItemCount()).toBe(3));

		const loadMoreButton = root.shadowRoot?.querySelector<HTMLButtonElement>(
			".cosense-card-links__load-more-button",
		);
		expect(loadMoreButton).not.toBeNull();
		await fireEvent.click(loadMoreButton!);

		await waitFor(() => expect(getRenderedItemCount()).toBe(7));
	});
});
