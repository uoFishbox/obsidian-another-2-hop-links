import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLazyLoadManager } from "../IntersectionObserverRegistry";

interface MockObserverRecord {
	options?: IntersectionObserverInit;
	observe: ReturnType<typeof vi.fn>;
	unobserve: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

const observerRecords: MockObserverRecord[] = [];
let originalIntersectionObserver:
	| typeof globalThis.IntersectionObserver
	| undefined;

describe("IntersectionObserverRegistry", () => {
	beforeEach(() => {
		observerRecords.length = 0;
		originalIntersectionObserver = globalThis.IntersectionObserver;

			class MockIntersectionObserver {
				root: IntersectionObserver["root"] = null;
			rootMargin = "";
			thresholds: ReadonlyArray<number> = [];
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			takeRecords = () => [];

			constructor(
				_callback: IntersectionObserverCallback,
				options?: IntersectionObserverInit,
			) {
				this.root = (options?.root ?? null) as IntersectionObserver["root"];
				this.rootMargin = options?.rootMargin ?? "0px";
				const rawThreshold = options?.threshold ?? 0;
				this.thresholds = Array.isArray(rawThreshold)
					? rawThreshold
					: [rawThreshold];

				observerRecords.push({
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
		getLazyLoadManager().cleanup();
		if (originalIntersectionObserver) {
			globalThis.IntersectionObserver = originalIntersectionObserver;
		}
	});

	it("disconnects and discards the shared observer when the last registration is removed", () => {
		const registry = getLazyLoadManager();
		const root = document.createElement("div");
		const element = document.createElement("div");
		const config = { root, rootMargin: "10px", threshold: 0 };

		const token = registry.observe(element, vi.fn(), config);

		expect(observerRecords).toHaveLength(1);

		registry.unobserve(token);

		expect(observerRecords[0]?.unobserve).toHaveBeenCalledWith(element);
		expect(observerRecords[0]?.disconnect).toHaveBeenCalledTimes(1);

		registry.observe(document.createElement("div"), vi.fn(), config);

		expect(observerRecords).toHaveLength(2);
	});

	it("does not disconnect while registrations remain on the same observer", () => {
		const registry = getLazyLoadManager();
		const root = document.createElement("div");
		const config = { root, rootMargin: "10px", threshold: 0 };
		const firstElement = document.createElement("div");
		const secondElement = document.createElement("div");

		const firstToken = registry.observe(firstElement, vi.fn(), config);
		const secondToken = registry.observe(secondElement, vi.fn(), config);

		expect(observerRecords).toHaveLength(1);

		registry.unobserve(firstToken);

		expect(observerRecords[0]?.unobserve).toHaveBeenCalledWith(firstElement);
		expect(observerRecords[0]?.disconnect).not.toHaveBeenCalled();

		registry.unobserve(secondToken);

		expect(observerRecords[0]?.unobserve).toHaveBeenCalledWith(secondElement);
		expect(observerRecords[0]?.disconnect).toHaveBeenCalledTimes(1);
	});
});
