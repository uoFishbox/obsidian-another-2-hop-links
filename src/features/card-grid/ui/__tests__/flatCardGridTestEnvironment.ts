import { cleanup, fireEvent } from "@testing-library/svelte";
import { afterEach, beforeEach } from "vitest";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
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

export interface FlatCardGridElements {
	readonly scrollRoot: HTMLElement;
	readonly gridRoot: HTMLElement;
}

export interface FlatCardGridViewportOptions {
	readonly rootHeight: number;
	readonly width: number;
	readonly sectionTop?: number;
	readonly scrollTop?: number;
}

export function createItems(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `Item ${index}`);
}

/** Finds the environment-owned scroll and grid roots for a rendered fixture. */
export function getFlatCardGridElements(container: HTMLElement): FlatCardGridElements {
	const scrollRoot = container.querySelector<HTMLElement>(
		"[data-testid='scroll-root']",
	);
	const gridRoot = container.querySelector<HTMLElement>(
		".cosense-card-links__virtual-grid",
	);

	if (!scrollRoot || !gridRoot) {
		throw new Error("Required FlatCardGrid test elements were not rendered");
	}

	return { scrollRoot, gridRoot };
}

/** Publishes stable viewport geometry through the same observer boundary as the browser. */
export async function setFlatCardGridViewport(
	elements: FlatCardGridElements,
	options: FlatCardGridViewportOptions,
): Promise<void> {
	const { scrollRoot, gridRoot } = elements;
	const sectionTop = options.sectionTop ?? 0;
	setNumericProperty(scrollRoot, "clientHeight", options.rootHeight);
	setNumericProperty(scrollRoot, "scrollTop", options.scrollTop ?? 0);
	scrollRoot.style.overflow = "auto";
	setElementRect(scrollRoot, {
		top: 0,
		width: options.width,
		height: options.rootHeight,
	});
	gridRoot.style.setProperty("--ccl-box-size", "100px");
	gridRoot.style.setProperty("--ccl-box-height", "120px");
	gridRoot.style.setProperty("--ccl-box-gap", "10px");
	gridRoot.style.setProperty("--ccl-box-cols-max", "4");
	setElementRect(gridRoot, {
		top: sectionTop,
		width: options.width,
		height: 2000,
	});
	triggerResize(gridRoot, options.width, 2000);
	triggerResize(scrollRoot, options.width, options.rootHeight);
	await flushFrames();
}

/** Scrolls the fixture through its public scroll event boundary. */
export async function scrollFlatCardGrid(
	elements: FlatCardGridElements,
	options: { readonly scrollTop: number; readonly sectionTop: number },
): Promise<void> {
	setNumericProperty(elements.scrollRoot, "scrollTop", options.scrollTop);
	setElementRect(elements.gridRoot, {
		top: options.sectionTop,
		width: elements.gridRoot.getBoundingClientRect().width,
		height: 2000,
	});
	await fireEvent.scroll(elements.scrollRoot);
	await flushFrames();
}

/** Installs and tears down browser observer fixtures for FlatCardGrid tests. */
export function setupFlatCardGridTestEnvironment(): void {
	beforeEach(() => {
		resetRecords();
		installResizeObserverMock();
		installIntersectionObserverMock();
		installAnimationFrameMock();
	});

	afterEach(() => {
		cleanup();
		getLazyLoadManager().cleanup();
		teardownResizeObserverMock();
		teardownIntersectionObserverMock();
		teardownAnimationFrameMock();
	});
}
