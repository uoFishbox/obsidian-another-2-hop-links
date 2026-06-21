import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import UseLazyRenderHarness from "./UseLazyRenderHarness.svelte";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";

interface MockObserverRecord {
	callback: IntersectionObserverCallback;
	options?: IntersectionObserverInit;
	observe: ReturnType<typeof vi.fn>;
	unobserve: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

const observerRecords: MockObserverRecord[] = [];
let originalIntersectionObserver:
	| typeof globalThis.IntersectionObserver
	| undefined;

function createIntersectionEntry(target: Element): IntersectionObserverEntry {
	return {
		target,
		isIntersecting: true,
		intersectionRatio: 1,
		boundingClientRect: {} as DOMRectReadOnly,
		intersectionRect: {} as DOMRectReadOnly,
		rootBounds: null,
		time: 0,
	};
}

function getObserverRecord(rootMargin: string): MockObserverRecord | undefined {
	for (let i = observerRecords.length - 1; i >= 0; i -= 1) {
		const record = observerRecords[i];
		if ((record?.options?.rootMargin ?? "0px") === rootMargin) {
			return record;
		}
	}

	return undefined;
}

function triggerIntersecting(rootMargin: string, target: Element): void {
	const record = getObserverRecord(rootMargin);
	if (!record) {
		throw new Error(`Observer not found for rootMargin: ${rootMargin}`);
	}

	record.callback(
		[createIntersectionEntry(target)],
		{} as IntersectionObserver,
	);
}

describe("lazyRender action", () => {
	beforeEach(() => {
		observerRecords.length = 0;
		originalIntersectionObserver = globalThis.IntersectionObserver;

		class MockIntersectionObserver {
			root = null;
			rootMargin = "";
			thresholds: ReadonlyArray<number> = [];
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			takeRecords = () => [];

			constructor(
				callback: IntersectionObserverCallback,
				options?: IntersectionObserverInit,
			) {
				this.rootMargin = options?.rootMargin ?? "0px";
				const rawThreshold = options?.threshold ?? 0;
				this.thresholds = Array.isArray(rawThreshold)
					? rawThreshold
					: [rawThreshold];

				observerRecords.push({
					callback,
					options,
					observe: this.observe,
					unobserve: this.unobserve,
					disconnect: this.disconnect,
				});
			}
		}

		globalThis.IntersectionObserver =
			MockIntersectionObserver as unknown as typeof IntersectionObserver;
	});

	afterEach(() => {
		cleanup();
		getLazyLoadManager().cleanup();
		if (originalIntersectionObserver) {
			globalThis.IntersectionObserver = originalIntersectionObserver;
		}
	});

	it("releases visible observer on unmount", async () => {
		const { getByTestId, unmount } = render(UseLazyRenderHarness, {
			props: {
				params: {
					cacheKey: "note-a",
					onVisible: vi.fn(),
				},
			},
		});

		const element = getByTestId("lazy-target");

		const visibleObserver = getObserverRecord("50px");

		unmount();

		expect(visibleObserver?.unobserve).toHaveBeenCalledWith(element);
	});

	it("reconfigures observer when cacheKey changes", async () => {
		const { getByTestId, rerender } = render(UseLazyRenderHarness, {
			props: {
				params: {
					cacheKey: "note-a",
					onVisible: vi.fn(),
				},
			},
		});

		const element = getByTestId("lazy-target");
		const firstVisibleObserver = getObserverRecord("50px");

		await rerender({
			params: {
				cacheKey: "note-b",
				onVisible: vi.fn(),
			},
		});

		expect(firstVisibleObserver?.unobserve).toHaveBeenCalledWith(element);
		triggerIntersecting("50px", element);
		await Promise.resolve();
	});

	it("cached cacheKey is treated as visible immediately", () => {
		const onVisible = vi.fn();
		const intersectedCache = new Set<string>(["note-a"]);

		render(UseLazyRenderHarness, {
			props: {
				params: {
					cacheKey: "note-a",
					intersectedCache,
					onVisible,
				},
			},
		});

		expect(onVisible).toHaveBeenCalledTimes(1);
	});
});
