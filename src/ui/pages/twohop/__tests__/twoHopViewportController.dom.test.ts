import { describe, expect, it, vi } from "vitest";
import { createTwoHopViewportController } from "../twoHopViewportController";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "../twoHopVirtualListModel";

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

describe("twoHopViewportController", () => {
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

		controller.flush(20);
		const afterResidentHit = controller.getStats();

		expect(afterResidentHit.poolRows).toBe(initialRows);
		expect(afterResidentHit.shellBinds).toBe(initialStats.shellBinds);
		expect(afterResidentHit.residentHits).toBe(initialStats.residentHits + 1);
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
});
