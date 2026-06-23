import { vi } from "vitest";

export interface ResizeObserverRecord {
	callback: ResizeObserverCallback;
	elements: Set<Element>;
}

export interface IntersectionObserverRecord {
	callback: IntersectionObserverCallback;
	elements: Set<Element>;
	options?: IntersectionObserverInit;
}

export interface MutationObserverRecord {
	callback: MutationCallback;
	elements: Set<Node>;
}

export const resizeObserverRecords: ResizeObserverRecord[] = [];
export const intersectionObserverRecords: IntersectionObserverRecord[] = [];
export const mutationObserverRecords: MutationObserverRecord[] = [];

let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;
let originalIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;
let originalMutationObserver: typeof globalThis.MutationObserver | undefined;
let originalRequestAnimationFrame: typeof globalThis.requestAnimationFrame | undefined;
let originalCancelAnimationFrame: typeof globalThis.cancelAnimationFrame | undefined;

export function createDomRect(params: {
	top: number;
	left?: number;
	width: number;
	height: number;
}): DOMRect {
	const left = params.left ?? 0;
	const bottom = params.top + params.height;
	const right = left + params.width;

	return {
		x: left,
		y: params.top,
		top: params.top,
		left,
		width: params.width,
		height: params.height,
		bottom,
		right,
		toJSON: () => ({}),
	} as DOMRect;
}

export function setElementRect(
	element: Element,
	params: {
		top: number;
		width: number;
		height: number;
		left?: number;
	},
): void {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => createDomRect(params),
	});
}

export function setNumericProperty(target: object, key: string, value: number): void {
	Object.defineProperty(target, key, {
		configurable: true,
		writable: true,
		value,
	});
}

export function triggerResize(target: Element, width: number, height = 0): void {
	const record = resizeObserverRecords.find((entry) => entry.elements.has(target));
	if (!record) {
		throw new Error("ResizeObserver target not found");
	}

	record.callback(
		[
			{
				target,
				contentRect: createDomRect({
					top: 0,
					width,
					height,
				}),
			} as ResizeObserverEntry,
		],
		{} as ResizeObserver,
	);
}

export function triggerIntersection(target: Element): void {
	const record = intersectionObserverRecords.find((entry) =>
		entry.elements.has(target),
	);
	if (!record) {
		throw new Error("IntersectionObserver target not found");
	}

	record.callback(
		[
			{
				target,
				isIntersecting: true,
				intersectionRatio: 1,
				boundingClientRect: createDomRect({
					top: 0,
					width: 1,
					height: 1,
				}),
				intersectionRect: createDomRect({
					top: 0,
					width: 1,
					height: 1,
				}),
				rootBounds: null,
				time: 0,
			} as IntersectionObserverEntry,
		],
		{} as IntersectionObserver,
	);
}

export async function flushFrames(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
}

export function resetRecords(): void {
	resizeObserverRecords.length = 0;
	intersectionObserverRecords.length = 0;
	mutationObserverRecords.length = 0;
}

export function installResizeObserverMock(): void {
	originalResizeObserver = globalThis.ResizeObserver;

	class MockResizeObserver {
		observe = vi.fn((element: Element) => {
			this.record.elements.add(element);
		});
		unobserve = vi.fn((element: Element) => {
			this.record.elements.delete(element);
		});
		disconnect = vi.fn(() => {
			this.record.elements.clear();
		});

		private readonly record: ResizeObserverRecord;

		constructor(callback: ResizeObserverCallback) {
			const record: ResizeObserverRecord = {
				callback,
				elements: new Set<Element>(),
			};
			this.record = record;
			resizeObserverRecords.push(record);
		}
	}

	globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

export function installIntersectionObserverMock(): void {
	originalIntersectionObserver = globalThis.IntersectionObserver;

	class MockIntersectionObserver {
		observe = vi.fn((element: Element) => {
			this.record.elements.add(element);
		});
		unobserve = vi.fn((element: Element) => {
			this.record.elements.delete(element);
		});
		disconnect = vi.fn(() => {
			this.record.elements.clear();
		});
		root: Element | Document | null = null;
		rootMargin = "";
		thresholds: ReadonlyArray<number> = [];
		takeRecords = () => [];

		private readonly record: IntersectionObserverRecord;

		constructor(
			callback: IntersectionObserverCallback,
			options?: IntersectionObserverInit,
		) {
			const record: IntersectionObserverRecord = {
				callback,
				elements: new Set<Element>(),
				options,
			};
			this.record = record;
			intersectionObserverRecords.push(record);
			this.rootMargin = options?.rootMargin ?? "";
			const threshold = options?.threshold ?? 0;
			this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
		}
	}

	globalThis.IntersectionObserver =
		MockIntersectionObserver as unknown as typeof IntersectionObserver;
}

export function installMutationObserverMock(): void {
	originalMutationObserver = globalThis.MutationObserver;

	class MockMutationObserver {
		private readonly record: MutationObserverRecord;

		observe = vi.fn((element: Node) => {
			this.record.elements.add(element);
		});

		disconnect = vi.fn(() => {
			this.record.elements.clear();
		});

		constructor(callback: MutationCallback) {
			this.record = {
				callback,
				elements: new Set<Node>(),
			};
			mutationObserverRecords.push(this.record);
		}
	}

	globalThis.MutationObserver =
		MockMutationObserver as unknown as typeof MutationObserver;
}

export function installAnimationFrameMock(): void {
	originalRequestAnimationFrame = globalThis.requestAnimationFrame;
	originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

	globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
		setTimeout(
			() => callback(Date.now()),
			0,
		)) as unknown as typeof requestAnimationFrame;

	globalThis.cancelAnimationFrame = ((handle: number) => {
		clearTimeout(handle);
	}) as typeof cancelAnimationFrame;
}

export function teardownResizeObserverMock(): void {
	if (originalResizeObserver) {
		globalThis.ResizeObserver = originalResizeObserver;
	} else {
		delete (globalThis as Partial<typeof globalThis>).ResizeObserver;
	}
	originalResizeObserver = undefined;
}

export function teardownIntersectionObserverMock(): void {
	if (originalIntersectionObserver) {
		globalThis.IntersectionObserver = originalIntersectionObserver;
	} else {
		delete (globalThis as Partial<typeof globalThis>).IntersectionObserver;
	}
	originalIntersectionObserver = undefined;
}

export function teardownMutationObserverMock(): void {
	if (originalMutationObserver) {
		globalThis.MutationObserver = originalMutationObserver;
	} else {
		delete (globalThis as Partial<typeof globalThis>).MutationObserver;
	}
	originalMutationObserver = undefined;
}

export function teardownAnimationFrameMock(): void {
	if (originalRequestAnimationFrame) {
		globalThis.requestAnimationFrame = originalRequestAnimationFrame;
	}
	originalRequestAnimationFrame = undefined;
	if (originalCancelAnimationFrame) {
		globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
	}
	originalCancelAnimationFrame = undefined;
}

export function setupDOMObserverMocks(): void {
	resetRecords();
	installResizeObserverMock();
	installAnimationFrameMock();
}

export function teardownDOMObserverMocks(): void {
	teardownResizeObserverMock();
	teardownAnimationFrameMock();
}
