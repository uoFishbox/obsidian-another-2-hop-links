import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UseWorkerSearchSessionHarness from "./UseWorkerSearchSessionHarness.svelte";
import type {
	SearchWorkerFileContentSnapshot,
	SearchWorkerItemSnapshot,
} from "../searchWorkerTypes";

type WorkerMessage =
	| {
			type: "filter-result";
			requestId: number;
			datasetVersion: number;
			matchedKeys: string[];
	  }
	| {
			type: "error";
			message: string;
			requestId?: number;
			datasetVersion?: number;
	  };

type PendingSearch = {
	query: string;
	matchScope: string | undefined;
	requestId: number;
	datasetVersion: number;
};

const workerHarness = vi.hoisted(() => {
	let handler: ((message: WorkerMessage) => void) | null = null;

	const client = {
		syncItems: vi.fn(),
		upsertFileContents: vi.fn(),
		removeFileContents: vi.fn(),
		filter: vi.fn(
			(request: {
				requestId: number;
				datasetVersion: number;
				query: string;
				matchScope?: string;
			}) => {
				pendingSearches.push({
					query: request.query,
					matchScope: request.matchScope,
					requestId: request.requestId,
					datasetVersion: request.datasetVersion,
				});
			},
		),
		terminate: vi.fn(),
	};

	const pendingSearches: PendingSearch[] = [];

	return {
		client,
		attach(nextHandler: (message: WorkerMessage) => void) {
			handler = nextHandler;
		},
		emit(message: WorkerMessage) {
			handler?.(message);
		},
		resolveFirstPendingSearch(matchedKeys: string[]) {
			const request = pendingSearches.shift();
			if (!request) throw new Error("No pending search");
			handler?.({
				type: "filter-result",
				requestId: request.requestId,
				datasetVersion: request.datasetVersion,
				matchedKeys,
			});
		},
		resolveLatestPendingSearch(matchedKeys: string[]) {
			const request = pendingSearches.pop();
			if (!request) throw new Error("No pending search");
			handler?.({
				type: "filter-result",
				requestId: request.requestId,
				datasetVersion: request.datasetVersion,
				matchedKeys,
			});
		},
		rejectLatestPendingSearch(message = "failed") {
			handler?.({
				type: "error",
				message,
			});
		},
		getPendingSearchQueries() {
			return pendingSearches.map((s) => s.query);
		},
		reset() {
			handler = null;
			pendingSearches.length = 0;
			client.syncItems.mockReset();
			client.upsertFileContents.mockReset();
			client.removeFileContents.mockReset();
			client.filter.mockReset();
			client.terminate.mockReset();
		},
	};
});

const fileContentIndexHarness = vi.hoisted(() => {
	const state = {
		isLoading: false,
		entries: [] as SearchWorkerFileContentSnapshot[],
	};

	return {
		state,
		setLoading(next: boolean) {
			state.isLoading = next;
		},
		setEntries(next: SearchWorkerFileContentSnapshot[]) {
			state.entries = next;
		},
		reset() {
			state.isLoading = false;
			state.entries = [];
		},
	};
});

vi.mock("../searchWorkerClient.js", () => ({
	createSearchWorkerClient: vi.fn((onMessage) => {
		workerHarness.attach(onMessage);
		return workerHarness.client;
	}),
}));

vi.mock("../useFileContentIndex.svelte.js", () => ({
	useFileContentIndex: () => ({
		hasMatch: vi.fn(() => false),
		isLoading: vi.fn(() => fileContentIndexHarness.state.isLoading),
		getFirstMatchPosition: vi.fn(() => undefined),
		forEachEntry: vi.fn((visitor) => {
			for (const entry of fileContentIndexHarness.state.entries) {
				visitor(entry.path, {
					content: entry.content,
					mtime: entry.mtime,
				});
			}
		}),
		getSerializableEntries: vi.fn(() => fileContentIndexHarness.state.entries),
	}),
}));

function createDataset(keys: string[]): SearchWorkerItemSnapshot[] {
	return keys.map((key) => ({
		key,
		searchText: key,
		targetFilePath: null,
	}));
}

async function flushAsyncUi(): Promise<void> {
	await Promise.resolve();
	await vi.runOnlyPendingTimersAsync();
	await Promise.resolve();
}

describe("useWorkerSearchSession", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		workerHarness.reset();
		fileContentIndexHarness.reset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not build dataset and keeps search state idle while disabled", async () => {
		const buildDataset = vi.fn(() => createDataset(["alpha"]));

		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "",
				enabled: false,
				files: [],
				dataset: [],
				buildDataset,
			},
		});

		await flushAsyncUi();

		expect(buildDataset).not.toHaveBeenCalled();
		expect(screen.getByTestId("matched-state")).toHaveTextContent("null");
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
	});

	it("clears matchedKeySet and filtering state when query is emptied", async () => {
		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushAsyncUi();

		workerHarness.resolveLatestPendingSearch(["alpha"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
		});

		await view.rerender({
			app: {} as never,
			query: "",
			enabled: true,
			files: [],
			dataset: createDataset(["alpha"]),
		});

		await flushAsyncUi();

		expect(screen.getByTestId("matched-state")).toHaveTextContent("null");
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
	});

	it("preserves search results and does not revert to filtering on unrelated rerenders", async () => {
		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushAsyncUi();

		workerHarness.resolveLatestPendingSearch(["alpha"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});

		await fireEvent.click(screen.getByTestId("rerender-noise"));
		await flushAsyncUi();

		expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
	});

	it("adopts only the latest query result even when a stale worker response arrives later", async () => {
		const dataset = createDataset(["alpha", "beta"]);
		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset,
			},
		});

		await flushAsyncUi();

		await view.rerender({
			app: {} as never,
			query: "beta",
			enabled: true,
			files: [],
			dataset,
		});

		await flushAsyncUi();

		workerHarness.resolveFirstPendingSearch(["alpha"]);
		await Promise.resolve();

		expect(screen.getByTestId("matched-state")).toHaveTextContent("null");
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");

		workerHarness.resolveLatestPendingSearch(["beta"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});
	});

	it("does not adopt a worker response from before a dataset update even with the same query", async () => {
		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushAsyncUi();

		await view.rerender({
			app: {} as never,
			query: "alpha",
			enabled: true,
			files: [],
			dataset: createDataset(["alpha", "beta"]),
		});

		await flushAsyncUi();

		workerHarness.resolveFirstPendingSearch(["alpha"]);
		await Promise.resolve();

		expect(screen.getByTestId("matched-state")).toHaveTextContent("null");
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");

		workerHarness.resolveLatestPendingSearch(["alpha", "beta"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha,beta");
		});
	});

	it("clears filtering state on worker error", async () => {
		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushAsyncUi();

		expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");

		workerHarness.rejectLatestPendingSearch("failed");

		await waitFor(() => {
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});
	});

	it("reflects body index matches in search results in eager mode", async () => {
		fileContentIndexHarness.setEntries([
			{
				path: "notes/beta.md",
				content: "body contains target token",
				mtime: 1,
			},
		]);

		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "target token",
				enabled: true,
				files: [],
				dataset: [
					{
						key: "beta",
						searchText: "beta title",
						targetFilePath: "notes/beta.md",
					},
				],
				contentSyncMode: "eager",
			},
		});

		await flushAsyncUi();

		workerHarness.resolveLatestPendingSearch(["beta"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
		});
	});

	it("can adopt search result updates after tick in progressive mode", async () => {
		fileContentIndexHarness.setLoading(true);
		fileContentIndexHarness.setEntries([
			{
				path: "notes/alpha.md",
				content: "alpha body content",
				mtime: 1,
			},
		]);

		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha body",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
				contentSyncMode: "progressive",
				progressiveSyncIntervalMs: 400,
			},
		});

		await flushAsyncUi();

		workerHarness.resolveLatestPendingSearch(["alpha"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
		});

		await vi.advanceTimersByTimeAsync(400);
		await flushAsyncUi();

		workerHarness.resolveLatestPendingSearch(["alpha"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});
	});

	it("terminates the worker client on destroy", async () => {
		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushAsyncUi();

		view.unmount();
		await flushAsyncUi();

		expect(workerHarness.client.terminate).toHaveBeenCalledTimes(1);
	});
});
