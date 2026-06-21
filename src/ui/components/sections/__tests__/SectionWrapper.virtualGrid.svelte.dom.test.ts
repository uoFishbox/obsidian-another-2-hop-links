import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARIA_LABELS } from "../../../../appConstants";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import { DEFAULT_SETTINGS } from "types/settings";
import SectionWrapperHarness from "./SectionWrapperHarness.svelte";
import {
	setElementRect,
	setNumericProperty,
	triggerResize,
	flushFrames,
	setupDOMObserverMocks,
	teardownDOMObserverMocks,
} from "testing/helpers/DOMObserverMock";

const TEST_LAYOUT_SETTINGS = {
	...DEFAULT_SETTINGS,
	cardWidthPx: 100,
	cardHeightRatio: 1.2,
	cardGapPx: 10,
	cardMaxColumns: 4,
};

function createItems(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `Item ${index}`);
}

function queryAllByTestIdDeep(testId: string): HTMLElement[] {
	const results: HTMLElement[] = [];
	for (const el of screen.queryAllByTestId(testId)) {
		results.push(el);
	}
	for (const host of document.querySelectorAll<HTMLElement>("*")) {
		if (host.shadowRoot) {
			for (const el of host.shadowRoot.querySelectorAll<HTMLElement>(
				`[data-testid="${testId}"]`,
			)) {
				if (!results.includes(el)) {
					results.push(el);
				}
			}
		}
	}
	return results;
}

function queryByLabelTextDeep(text: string): HTMLElement | null {
	for (const el of screen.queryAllByLabelText(text)) {
		return el;
	}
	for (const host of document.querySelectorAll<HTMLElement>("*")) {
		if (host.shadowRoot) {
			for (const el of host.shadowRoot.querySelectorAll<HTMLElement>(
				`[aria-label="${text}"]`,
			)) {
				return el;
			}
		}
	}
	return null;
}

function getVisibleItemCount(): number {
	return queryAllByTestIdDeep("item-cell").length;
}

function setupLayout(container: HTMLElement): void {
	const scrollRoot = container.querySelector<HTMLElement>(
		"[data-testid='scroll-root']",
	);
	const virtualGrid = container.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);
	if (!scrollRoot || !virtualGrid) {
		throw new Error("Required elements not found");
	}

	setNumericProperty(scrollRoot, "clientHeight", 260);
	setNumericProperty(scrollRoot, "scrollTop", 0);
	scrollRoot.style.overflow = "auto";
	setElementRect(scrollRoot, { top: 0, width: 330, height: 260 });
	virtualGrid.style.setProperty("--ccl-box-size", "100px");
	virtualGrid.style.setProperty("--ccl-box-height", "120px");
	virtualGrid.style.setProperty("--ccl-box-gap", "10px");
	virtualGrid.style.setProperty("--ccl-box-cols-max", "4");
	setElementRect(virtualGrid, { top: 0, width: 330, height: 2000 });
	triggerResize(virtualGrid, 330, 2000);
}

describe("SectionWrapper virtual grid integration", () => {
	beforeEach(() => {
		setupDOMObserverMocks();
	});

	afterEach(() => {
		teardownDOMObserverMocks();
	});

	it("persists expandedLimit when load more is clicked", async () => {
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			settings: TEST_LAYOUT_SETTINGS,
			getDefaultSectionVisibleLimit: vi.fn(() => 3),
			getSectionExpandedLimit: vi.fn((sectionId: string) =>
				expandedLimits.get(sectionId),
			),
			setSectionExpandedLimit: vi.fn(
				(sectionId: string, limit: number) => {
					expandedLimits.set(sectionId, limit);
				},
			),
		} as unknown as ApplicationStore;

		const { container } = render(SectionWrapperHarness, {
			props: {
				items: createItems(8),
				applicationStore,
				initialVisibleCount: 3,
				loadMoreIncrement: 3,
			},
		});

		setupLayout(container);
		await flushFrames();

		expect(getVisibleItemCount()).toBe(3);

		const button = queryByLabelTextDeep(ARIA_LABELS.LOAD_MORE);
		if (!button) {
			throw new Error("Load more button not found");
		}
		await fireEvent.click(button);
		await flushFrames();

		expect(getVisibleItemCount()).toBe(6);
		expect(
			applicationStore.setSectionExpandedLimit,
		).toHaveBeenLastCalledWith("section-under-test", 6);
	});
});
