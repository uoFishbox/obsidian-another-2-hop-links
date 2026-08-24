import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchWorkerFilterTimeSlicedOptions } from "../searchWorkerFilter";
import type { SearchWorkerItemSnapshot } from "../searchWorkerTypes";
import UseWorkerSearchSessionHarness from "./UseWorkerSearchSessionHarness.svelte";

const buildTestSnapshot = (
	key: string,
	searchText: string,
	targetFilePath: string | null,
): SearchWorkerItemSnapshot => ({
	key,
	searchText: searchText.toLowerCase(),
	targetFilePath,
});

const contentEntries = [
	{
		path: "notes/beta.md",
		content: "body contains the recovery token",
	},
];

const fallbackHarness = vi.hoisted(() => {
	let shouldDelayNext = false;
	let pendingResolve: (() => void) | null = null;

	return {
		delayNext() {
			shouldDelayNext = true;
		},
		releasePending() {
			pendingResolve?.();
			pendingResolve = null;
		},
		reset() {
			shouldDelayNext = false;
			pendingResolve = null;
		},
		async filter(
			options: SearchWorkerFilterTimeSlicedOptions,
			filter: (options: SearchWorkerFilterTimeSlicedOptions) => Promise<void>,
		) {
			if (shouldDelayNext) {
				shouldDelayNext = false;
				await new Promise<void>((resolve) => {
					pendingResolve = resolve;
				});
			}

			if (options.isCancelled?.()) return;
			await filter(options);
		},
	};
});

vi.mock("../searchWorkerFilter.js", async () => {
	const actual = await vi.importActual<typeof import("../searchWorkerFilter")>(
		"../searchWorkerFilter",
	);

	return {
		...actual,
		filterSearchWorkerDatasetWithMatchDetailsTimeSliced: (
			options: SearchWorkerFilterTimeSlicedOptions,
		) =>
			fallbackHarness.filter(
				options,
				actual.filterSearchWorkerDatasetWithMatchDetailsTimeSliced,
			),
	};
});

vi.mock("../useFileContentIndex.svelte.js", () => ({
	useFileContentIndex: () => ({
		isLoading: vi.fn(() => false),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn((visitor) => {
			for (const entry of contentEntries) {
				visitor(entry.path, entry);
			}
		}),
	}),
}));

describe("useWorkerSearchSession fallback", () => {
	beforeEach(() => {
		fallbackHarness.reset();
	});

	afterEach(() => {
		fallbackHarness.releasePending();
		cleanup();
	});
	it("works with fallback filter when worker is unavailable", async () => {
		const originalWorker = globalThis.Worker;
		// Worker 未対応環境では session が fallback 検索を実行する
		Reflect.set(globalThis, "Worker", undefined);

		try {
			render(UseWorkerSearchSessionHarness, {
				props: {
					app: {} as never,
					query: "alpha",
					enabled: true,
					files: [],
					dataset: [
						buildTestSnapshot("alpha", "alpha note", null),
						buildTestSnapshot("beta", "beta note", "notes/beta.md"),
					],
				},
			});

			await waitFor(() => {
				expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
			});
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});

	it("matches body content through the fallback filter", async () => {
		const originalWorker = globalThis.Worker;
		Reflect.set(globalThis, "Worker", undefined);

		try {
			render(UseWorkerSearchSessionHarness, {
				props: {
					app: {} as never,
					query: "recovery token",
					enabled: true,
					files: [],
					matchScope: "title-and-content",
					dataset: [buildTestSnapshot("beta", "beta note", "notes/beta.md")],
				},
			});

			await waitFor(() => {
				expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
				expect(screen.getByTestId("beta-matched-content")).toHaveTextContent(
					"true",
				);
			});
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});

	it("does not publish a stale fallback result after a newer query", async () => {
		const originalWorker = globalThis.Worker;
		Reflect.set(globalThis, "Worker", undefined);
		fallbackHarness.delayNext();

		try {
			const view = render(UseWorkerSearchSessionHarness, {
				props: {
					app: {} as never,
					query: "alpha",
					enabled: true,
					files: [],
					dataset: [buildTestSnapshot("alpha", "alpha note", null)],
				},
			});
			await tick();

			await tick();
			await view.rerender({
				app: {} as never,
				query: "beta",
				enabled: true,
				files: [],
				dataset: [buildTestSnapshot("beta", "beta note", null)],
			});

			await waitFor(() => {
				expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
			});
			fallbackHarness.releasePending();
			await Promise.resolve();
			expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});

	it("does not publish a stale fallback result after a dataset update", async () => {
		const originalWorker = globalThis.Worker;
		Reflect.set(globalThis, "Worker", undefined);
		fallbackHarness.delayNext();

		try {
			const view = render(UseWorkerSearchSessionHarness, {
				props: {
					app: {} as never,
					query: "alpha",
					enabled: true,
					files: [],
					dataset: [buildTestSnapshot("alpha", "alpha note", null)],
				},
			});
			await tick();

			await tick();
			await view.rerender({
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: [buildTestSnapshot("beta", "beta note", null)],
			});
			await tick();

			expect(screen.getByTestId("matched-state")).not.toHaveTextContent("alpha");
			fallbackHarness.releasePending();

			await waitFor(() => {
				expect(screen.getByTestId("matched-state")).toHaveTextContent(/^$/);
				expect(screen.getByTestId("matched-query")).toHaveTextContent("alpha");
			});
			fallbackHarness.releasePending();
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});

	it("cancels fallback filtering when the component is destroyed", async () => {
		const originalWorker = globalThis.Worker;
		Reflect.set(globalThis, "Worker", undefined);
		fallbackHarness.delayNext();

		try {
			const view = render(UseWorkerSearchSessionHarness, {
				props: {
					app: {} as never,
					query: "alpha",
					enabled: true,
					files: [],
					dataset: [buildTestSnapshot("alpha", "alpha note", null)],
				},
			});

			view.unmount();
			fallbackHarness.releasePending();
			await Promise.resolve();
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});
});
