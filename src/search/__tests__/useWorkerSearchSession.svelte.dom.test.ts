import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UseWorkerSearchSessionHarness from "./UseWorkerSearchSessionHarness.svelte";
import type {
	SearchWorkerFileContentSnapshot,
	SearchWorkerItemSnapshot,
	SearchWorkerMatchedItem,
} from "../searchWorkerTypes";

type WorkerMessage =
	| {
			type: "filter-result";
			requestId: number;
			datasetVersion: number;
			matchedItems: SearchWorkerMatchedItem[];
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
		resolveFirstPendingSearch(keys: string[]) {
			const request = pendingSearches.shift();
			if (!request) throw new Error("No pending search");
			handler?.({
				type: "filter-result",
				requestId: request.requestId,
				datasetVersion: request.datasetVersion,
				matchedItems: keys.map((key) => ({ key, contentMatched: false })),
			});
		},
		resolveLatestPendingSearch(
			keys: string[],
			matchedItems?: SearchWorkerMatchedItem[],
		) {
			const request = pendingSearches.pop();
			if (!request) throw new Error("No pending search");
			handler?.({
				type: "filter-result",
				requestId: request.requestId,
				datasetVersion: request.datasetVersion,
				matchedItems:
					matchedItems ?? keys.map((key) => ({ key, contentMatched: false })),
			});
		},
		rejectLatestPendingSearch(message = "failed") {
			pendingSearches.pop();
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
				visitor(entry.path, entry);
			}
		}),
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

async function flushReactiveUi(): Promise<void> {
	await tick();
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

	it("clears matchesByKey and filtering state when query is emptied", async () => {
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

	it("represents a completed search with no matches as an empty result", async () => {
		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "missing",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushAsyncUi();
		workerHarness.resolveLatestPendingSearch([]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent(/^$/);
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});
	});

	it("uses the last match detail for duplicate keys", async () => {
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
		workerHarness.resolveLatestPendingSearch(
			["alpha"],
			[
				{
					key: "alpha",
					contentMatched: false,
				},
				{
					key: "alpha",
					contentMatched: true,
					contentPreview: "latest preview",
				},
			],
		);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
		});
		expect(screen.getByTestId("matched-content")).toHaveTextContent("true");
		expect(screen.getByTestId("matched-preview")).toHaveTextContent(
			"latest preview",
		);
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

	it("clears previous results while a different query is filtering", async () => {
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
		workerHarness.resolveLatestPendingSearch(["alpha"]);
		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
			expect(screen.getByTestId("matched-query")).toHaveTextContent("alpha");
		});

		await view.rerender({
			app: {} as never,
			query: "beta",
			enabled: true,
			files: [],
			dataset,
		});
		await flushAsyncUi();

		expect(screen.getByTestId("matched-state")).toHaveTextContent("null");
		expect(screen.getByTestId("matched-query")).toHaveTextContent(/^$/);
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");

		workerHarness.resolveLatestPendingSearch(["beta"]);
		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
			expect(screen.getByTestId("matched-query")).toHaveTextContent("beta");
		});
	});

	it("keeps current results while the same query is re-filtering", async () => {
		const initialDataset = createDataset(["alpha"]);
		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				files: [],
				dataset: initialDataset,
			},
		});

		await flushAsyncUi();
		workerHarness.resolveLatestPendingSearch(["alpha"]);
		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
		});

		await view.rerender({
			app: {} as never,
			query: "alpha",
			enabled: true,
			files: [],
			dataset: createDataset(["alpha", "beta"]),
		});
		await flushAsyncUi();

		expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
		expect(screen.getByTestId("matched-query")).toHaveTextContent("alpha");
		expect(screen.getByTestId("is-filtering")).toHaveTextContent("true");
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

	it("reissues the current search after a worker error", async () => {
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
			expect(workerHarness.client.filter).toHaveBeenCalledTimes(1);
			expect(screen.getByTestId("matched-state")).toHaveTextContent("alpha");
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});
	});

	it("reflects body index matches when loading has completed", async () => {
		fileContentIndexHarness.setEntries([
			{
				path: "notes/beta.md",
				content: "body contains target token",
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
			},
		});

		await flushAsyncUi();

		workerHarness.resolveLatestPendingSearch(["beta"]);

		await waitFor(() => {
			expect(screen.getByTestId("matched-state")).toHaveTextContent("beta");
		});
	});

	it("syncs loading content once after a 400ms one-shot delay", async () => {
		fileContentIndexHarness.setLoading(true);
		fileContentIndexHarness.setEntries([
			{
				path: "notes/alpha.md",
				content: "alpha body content",
			},
		]);

		render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha body",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushReactiveUi();
		workerHarness.resolveLatestPendingSearch(["alpha"]);
		await flushReactiveUi();

		expect(workerHarness.client.upsertFileContents).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(399);
		expect(workerHarness.client.upsertFileContents).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await flushAsyncUi();
		expect(workerHarness.client.upsertFileContents).toHaveBeenCalledTimes(1);

		workerHarness.resolveLatestPendingSearch(["alpha"]);
		await waitFor(() => {
			expect(screen.getByTestId("is-filtering")).toHaveTextContent("false");
		});

		await vi.advanceTimersByTimeAsync(400);
		await flushAsyncUi();
		expect(workerHarness.client.upsertFileContents).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(400);
		await flushAsyncUi();
		expect(workerHarness.client.upsertFileContents).toHaveBeenCalledTimes(1);
	});

	it("invalidates the previous partial sync timer when the query changes", async () => {
		fileContentIndexHarness.setLoading(true);
		fileContentIndexHarness.setEntries([
			{
				path: "notes/alpha.md",
				content: "alpha body content",
			},
		]);

		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha body",
				enabled: true,
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushReactiveUi();
		await vi.advanceTimersByTimeAsync(399);

		await view.rerender({
			app: {} as never,
			query: "beta body",
			enabled: true,
			files: [],
			dataset: createDataset(["alpha"]),
		});
		await flushReactiveUi();

		await vi.advanceTimersByTimeAsync(1);
		await flushReactiveUi();
		expect(workerHarness.client.upsertFileContents).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(399);
		await vi.advanceTimersByTimeAsync(1);
		await flushReactiveUi();
		expect(workerHarness.client.upsertFileContents).toHaveBeenCalledTimes(1);
	});

	it("does not remove synced worker contents when the query is emptied", async () => {
		fileContentIndexHarness.setEntries([
			{
				path: "notes/alpha.md",
				content: "alpha body content",
			},
		]);

		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha body",
				enabled: true,
				enabledFromQuery: true,
				contentIndexEnabled: true,
				files: [],
				dataset: [
					{
						key: "alpha",
						searchText: "alpha title",
						targetFilePath: "notes/alpha.md",
					},
				],
			},
		});

		await flushAsyncUi();

		expect(workerHarness.client.upsertFileContents).toHaveBeenCalledWith({
			datasetVersion: expect.any(Number),
			entries: [
				{
					path: "notes/alpha.md",
					content: "alpha body content",
				},
			],
		});

		await view.rerender({
			app: {} as never,
			query: "",
			enabled: true,
			enabledFromQuery: true,
			contentIndexEnabled: true,
			files: [],
			dataset: [
				{
					key: "alpha",
					searchText: "alpha title",
					targetFilePath: "notes/alpha.md",
				},
			],
		});

		await flushAsyncUi();

		expect(workerHarness.client.removeFileContents).not.toHaveBeenCalled();
	});

	it("removes stale worker content paths before the next filter", async () => {
		fileContentIndexHarness.setEntries([
			{
				path: "notes/alpha.md",
				content: "alpha body content",
			},
		]);

		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha body",
				enabled: true,
				contentIndexEnabled: true,
				files: [],
				dataset: [
					{
						key: "alpha",
						searchText: "alpha title",
						targetFilePath: "notes/alpha.md",
					},
				],
			},
		});

		await flushAsyncUi();
		expect(workerHarness.client.upsertFileContents).toHaveBeenCalled();

		fileContentIndexHarness.setEntries([]);
		await view.rerender({
			app: {} as never,
			query: "alpha body",
			enabled: true,
			contentIndexEnabled: true,
			files: [],
			dataset: [
				{
					key: "alpha",
					searchText: "alpha title",
					targetFilePath: "notes/alpha.md",
				},
			],
		});
		await flushAsyncUi();

		expect(workerHarness.client.removeFileContents).toHaveBeenCalledWith({
			datasetVersion: expect.any(Number),
			paths: ["notes/alpha.md"],
		});
		view.unmount();
	});

	it("cleans up the partial sync timer on destroy", async () => {
		fileContentIndexHarness.setLoading(true);
		const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
		const view = render(UseWorkerSearchSessionHarness, {
			props: {
				app: {} as never,
				query: "alpha",
				enabled: true,
				matchScope: "title-and-content",
				files: [],
				dataset: createDataset(["alpha"]),
			},
		});

		await flushReactiveUi();
		view.unmount();

		expect(clearTimeoutSpy).toHaveBeenCalled();
		clearTimeoutSpy.mockRestore();
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
