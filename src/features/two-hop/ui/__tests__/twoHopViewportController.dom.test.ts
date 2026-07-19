import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTwoHopViewportController } from "features/two-hop/ui/viewport/twoHopViewportController";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	installResizeObserverMock,
	resetRecords,
	teardownResizeObserverMock,
	triggerResize,
} from "testing/helpers/DOMObserverMock";

function createItems(count: number): TwoHopVirtualListItem[] {
	return Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		interactionId: `item:${index}`,
		searchKey: `item:${index}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
}

function createSection(
	sectionId: string,
	count: number,
): TwoHopVirtualSectionDescriptor {
	const items = createItems(count);
	return {
		section: {
			kind: "new-links-section",
			rawSectionId: sectionId,
			sectionId,
			sectionKey: sectionId,
			title: sectionId,
			getKey: (_item, index) => `${sectionId}:${index}`,
		},
		sectionKey: sectionId,
		sectionId,
		title: sectionId,
		totalCount: count,
		loadedCount: count,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
}

function setRect(element: Element, top: number, width: number, height: number) {
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
		x: 0,
		y: top,
		top,
		left: 0,
		right: width,
		bottom: top + height,
		width,
		height,
		toJSON: () => ({}),
	});
}

const resolveItemTitle = (item: TwoHopVirtualListItem): string => item.virtualKey;

describe("twoHopViewportController", () => {
	beforeEach(() => {
		installResizeObserverMock();
	});

	afterEach(() => {
		teardownResizeObserverMock();
		resetRecords();
	});

	it("does not rebuild when the initial sections revision is set again", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 300 });
		Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
		Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 420, 300);
		setRect(rootEl, 0, 420, 5000);
		const sections = [createSection("section", 100)];
		const revision = {};
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections,
			revision,
			initialVisibleCount: 100,
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			now: () => 10,
		});
		const initialStats = controller.getStats();

		controller.setSections(sections, revision);

		expect(controller.getStats()).toEqual(initialStats);
		controller.dispose();
		scroller.remove();
	});

	it("reuses shell titles when only the rich card revision changes", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 300 });
		Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
		Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 420, 300);
		setRect(rootEl, 0, 420, 5000);
		const sections = [createSection("section", 10)];
		const shellTitleRevision = {};
		const resolveItemTitle = vi.fn(
			(item: TwoHopVirtualListItem) => `Title ${item.virtualKey}`,
		);
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections,
			revision: {},
			shellTitleRevision,
			initialVisibleCount: 10,
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			now: () => 10,
		});
		expect(resolveItemTitle).toHaveBeenCalledTimes(10);

		controller.setSections(sections, {}, shellTitleRevision);

		expect(resolveItemTitle).toHaveBeenCalledTimes(10);
		controller.dispose();
		scroller.remove();
	});

	it("keeps a fixed pool and performs no shell binds on resident hits", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 300 });
		Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
		Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 420, 300);
		setRect(rootEl, 0, 420, 5000);
		const queuedFrames: FrameRequestCallback[] = [];
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections: [createSection("section", 100)],
			initialVisibleCount: 100,
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: (callback) => {
				queuedFrames.push(callback);
				return queuedFrames.length;
			},
			cancelAnimationFrame: () => {},
			now: () => 10,
		});
		const initialStats = controller.getStats();
		const initialRows = controller.contentEl.querySelectorAll(
			".twohop-imperative-row",
		).length;

		for (let frame = 0; frame < 300; frame += 1) {
			controller.flush(20 + frame * 4.2);
		}
		const afterResidentHit = controller.getStats();

		expect(afterResidentHit.poolRows).toBe(initialRows);
		expect(afterResidentHit.shellBinds).toBe(initialStats.shellBinds);
		expect(afterResidentHit.residentHits).toBe(initialStats.residentHits + 300);
		controller.dispose();
		scroller.remove();
	});

	it("flushes when resize updates scroll geometry without changing layout", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 300 });
		Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
		Object.defineProperty(scroller, "scrollTop", {
			value: 1000,
			writable: true,
		});
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 100, 300);
		let rootTop = -1000;
		vi.spyOn(rootEl, "getBoundingClientRect").mockImplementation(() => ({
			x: 0,
			y: rootTop,
			top: rootTop,
			left: 0,
			right: 100,
			bottom: rootTop + 10000,
			width: 100,
			height: 10000,
			toJSON: () => ({}),
		}));
		const queuedFrames: FrameRequestCallback[] = [];
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections: [createSection("section", 100)],
			initialVisibleCount: 100,
			configuredLayout: {
				cardWidthPx: 100,
				cardHeightPx: 100,
				cardHeightRatio: 1,
				cardGapPx: 0,
				cardMaxColumns: 1,
				sectionMarginBottomPx: 0,
			},
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: (callback) => {
				queuedFrames.push(callback);
				return queuedFrames.length;
			},
			cancelAnimationFrame: () => {},
			now: () => 10,
		});
		const beforeResize = controller.getStats();
		rootTop = -500;

		triggerResize(rootEl, 100, 10000);
		queuedFrames.at(-1)?.(10);

		expect(controller.getStats().scrollFrames).toBe(beforeResize.scrollFrames + 1);
		expect(controller.getStats().poolRows).toBe(beforeResize.poolRows);
		controller.dispose();
		scroller.remove();
	});

	it("uses bounded rich binds and skeleton fallback after a distant jump", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 300 });
		Object.defineProperty(scroller, "scrollHeight", { value: 20000 });
		Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 420, 300);
		vi.spyOn(rootEl, "getBoundingClientRect").mockImplementation(() => ({
			x: 0,
			y: -scroller.scrollTop,
			top: -scroller.scrollTop,
			left: 0,
			right: 420,
			bottom: 20000 - scroller.scrollTop,
			width: 420,
			height: 20000,
			toJSON: () => ({}),
		}));
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections: [createSection("section", 1000)],
			initialVisibleCount: 1000,
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			now: () => 100,
		});
		const beforeJump = controller.getStats();
		scroller.scrollTop = 10000;

		controller.flush(104.2);
		const afterJump = controller.getStats();

		expect(afterJump.distantJumps).toBe(beforeJump.distantJumps + 1);
		expect(afterJump.shellBinds - beforeJump.shellBinds).toBeLessThanOrEqual(16);
		expect(afterJump.skeletonBinds).toBeGreaterThan(beforeJump.skeletonBinds);
		expect(afterJump.poolRows).toBe(beforeJump.poolRows);
		controller.dispose();
		scroller.remove();
	});

	it("charges rich-bind budget by actual cells while binding each row atomically", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 100 });
		Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
		Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 300, 100);
		setRect(rootEl, 0, 300, 10000);

		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections: [
				createSection("partial-section", 3),
				createSection("section", 100),
			],
			initialVisibleCount: 100,
			resolveItemTitle,
			configuredLayout: {
				cardWidthPx: 100,
				cardHeightPx: 100,
				cardHeightRatio: 1,
				cardGapPx: 0,
				cardMaxColumns: 3,
				sectionMarginBottomPx: 0,
			},
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			now: () => 10,
		});

		const stats = controller.getStats();
		expect(stats.shellBinds).toBe(13);
		expect(stats.skeletonBinds).toBeGreaterThan(0);
		controller.dispose();
		scroller.remove();
	});

	it("anchors scroll and does not regenerate other-section card models on load more", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 300 });
		Object.defineProperty(scroller, "scrollHeight", { value: 20000 });
		Object.defineProperty(scroller, "scrollTop", { value: 350, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 210, 300);
		vi.spyOn(rootEl, "getBoundingClientRect").mockImplementation(() => ({
			x: 0,
			y: -scroller.scrollTop,
			top: -scroller.scrollTop,
			left: 0,
			right: 210,
			bottom: 20000 - scroller.scrollTop,
			width: 210,
			height: 20000,
			toJSON: () => ({}),
		}));
		const first = createSection("first", 8);
		const second = createSection("second", 8);
		const firstGetItem = vi.spyOn(first, "getItem");
		const secondGetItem = vi.spyOn(second, "getItem");
		const resolveItemCardModel = vi.fn(
			(item: TwoHopVirtualListItem, presentation) => ({
				item: item.item,
				targetFile: null,
				title: item.virtualKey,
				ariaLabel: item.virtualKey,
				className: null,
				extension: null,
				directory: null,
				interactionId: item.interactionId ?? item.virtualKey,
				interactionKey: item.virtualKey,
				presentation,
				searchQuery: "",
				searchScope: "title-only" as const,
				contentPreview: undefined,
				previewRefreshToken: 0,
				previewActivationIdentity: undefined,
			}),
		);
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections: [first, second],
			initialVisibleCount: 1,
			loadMoreIncrement: 2,
			configuredLayout: {
				cardWidthPx: 100,
				cardHeightPx: 100,
				cardHeightRatio: 1,
				cardGapPx: 10,
				cardMaxColumns: 2,
				sectionMarginBottomPx: 20,
			},
			resolveItemCardModel,
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			now: () => 10,
		});
		const secondHeaderBefore = controller.contentEl.querySelector<HTMLElement>(
			"[data-testid='section-block-second']",
		);
		const secondHeaderRowBefore = secondHeaderBefore?.parentElement;
		expect(secondHeaderRowBefore?.dataset.cclRowIndex).toBe("2");
		const secondItems = new Set(second.getItems());
		const secondCallsBefore = resolveItemCardModel.mock.calls.filter(([item]) =>
			secondItems.has(item),
		).length;
		const scrollTopBefore = scroller.scrollTop;
		firstGetItem.mockClear();
		secondGetItem.mockClear();

		controller.loadMore("first");

		const secondCallsAfter = resolveItemCardModel.mock.calls.filter(([item]) =>
			secondItems.has(item),
		).length;
		const secondHeaderAfter = controller.contentEl.querySelector<HTMLElement>(
			"[data-testid='section-block-second']",
		);
		const secondHeaderRowAfter = secondHeaderAfter?.parentElement;
		expect(scroller.scrollTop).toBe(scrollTopBefore + 110);
		expect(firstGetItem.mock.calls.map(([index]) => index)).toEqual([1, 2]);
		expect(secondGetItem).not.toHaveBeenCalled();
		expect(secondCallsAfter).toBe(secondCallsBefore);
		expect(secondHeaderRowAfter?.dataset.cclRowIndex).toBe("3");
		expect(secondHeaderRowAfter?.style.top).toBe("340px");
		controller.dispose();
		scroller.remove();
	});

	it("consumes the load-more click before its shell is rebound to a card", () => {
		const scroller = document.createElement("div");
		scroller.style.overflow = "auto";
		Object.defineProperty(scroller, "clientHeight", { value: 400 });
		Object.defineProperty(scroller, "scrollHeight", { value: 10000 });
		Object.defineProperty(scroller, "scrollTop", { value: 0, writable: true });
		const rootEl = document.createElement("div");
		const shadowHostEl = document.createElement("div");
		rootEl.append(shadowHostEl);
		scroller.append(rootEl);
		document.body.append(scroller);
		setRect(scroller, 0, 210, 400);
		setRect(rootEl, 0, 210, 10000);
		const outerClick = vi.fn();
		rootEl.addEventListener("click", outerClick);
		const controller = createTwoHopViewportController({
			rootEl,
			shadowHostEl,
			sections: [createSection("section", 8)],
			initialVisibleCount: 1,
			loadMoreIncrement: 2,
			configuredLayout: {
				cardWidthPx: 100,
				cardHeightPx: 100,
				cardHeightRatio: 1,
				cardGapPx: 10,
				cardMaxColumns: 2,
				sectionMarginBottomPx: 20,
			},
			resolveItemTitle,
			getItemInteractionDescriptor: () => null,
			requestAnimationFrame: () => 1,
			cancelAnimationFrame: () => {},
			now: () => 10,
		});
		const loadMore = controller.contentEl.querySelector<HTMLElement>(
			"[data-two-hop-load-more-section='section']",
		);
		expect(loadMore).toBeTruthy();

		const click = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		loadMore?.dispatchEvent(click);

		expect(click.defaultPrevented).toBe(true);
		expect(outerClick).not.toHaveBeenCalled();
		expect(loadMore?.dataset.cclInteractionKind).toBe("item");
		controller.dispose();
		scroller.remove();
	});
});
