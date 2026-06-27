import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLazyLoadManager } from "../IntersectionObserverRegistry";

interface MockObserverRecord {
	options?: IntersectionObserverInit;
	observe: ReturnType<typeof vi.fn>;
	unobserve: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}

type WindowWithIntersectionObserver = Window & {
	IntersectionObserver?: typeof IntersectionObserver;
};

const observerRecords: MockObserverRecord[] = [];
let originalIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;

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

	it("uses the observed element owner window IntersectionObserver", () => {
		const registry = getLazyLoadManager();
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const frameDocument = frame.contentDocument;
		const frameWindow =
			frame.contentWindow as WindowWithIntersectionObserver | null;
		expect(frameDocument).toBeTruthy();
		expect(frameWindow).toBeTruthy();
		if (!frameDocument || !frameWindow) {
			return;
		}

		const foreignRecords: MockObserverRecord[] = [];
		class ForeignIntersectionObserver {
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
				foreignRecords.push({
					options,
					observe: this.observe,
					unobserve: this.unobserve,
					disconnect: this.disconnect,
				});
			}
		}
		frameWindow.IntersectionObserver =
			ForeignIntersectionObserver as unknown as typeof IntersectionObserver;

		const element = frameDocument.createElement("div");
		registry.observe(element, vi.fn(), {
			root: null,
			rootMargin: "10px",
			threshold: 0,
		});

		expect(observerRecords).toHaveLength(0);
		expect(foreignRecords).toHaveLength(1);
		expect(foreignRecords[0]?.observe).toHaveBeenCalledWith(element);
	});

	it("keeps shared observers separate across owner windows", () => {
		const registry = getLazyLoadManager();
		const frame = document.createElement("iframe");
		document.body.append(frame);
		const frameDocument = frame.contentDocument;
		const frameWindow =
			frame.contentWindow as WindowWithIntersectionObserver | null;
		expect(frameDocument).toBeTruthy();
		expect(frameWindow).toBeTruthy();
		if (!frameDocument || !frameWindow) {
			return;
		}

		const foreignRecords: MockObserverRecord[] = [];
		class ForeignIntersectionObserver {
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
				foreignRecords.push({
					options,
					observe: this.observe,
					unobserve: this.unobserve,
					disconnect: this.disconnect,
				});
			}
		}
		frameWindow.IntersectionObserver =
			ForeignIntersectionObserver as unknown as typeof IntersectionObserver;

		const config = { root: null, rootMargin: "10px", threshold: 0 };
		const mainElement = document.createElement("div");
		const foreignElement = frameDocument.createElement("div");

		registry.observe(mainElement, vi.fn(), config);
		registry.observe(foreignElement, vi.fn(), config);

		expect(observerRecords).toHaveLength(1);
		expect(foreignRecords).toHaveLength(1);
		expect(observerRecords[0]?.observe).toHaveBeenCalledWith(mainElement);
		expect(foreignRecords[0]?.observe).toHaveBeenCalledWith(foreignElement);
	});
});
