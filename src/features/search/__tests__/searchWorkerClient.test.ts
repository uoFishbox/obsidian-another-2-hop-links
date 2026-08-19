import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workerHarness = vi.hoisted(() => ({
	factory: vi.fn(),
	postMessage: vi.fn(),
	terminate: vi.fn(),
}));

vi.mock("../searchFilter.worker", () => ({
	default: workerHarness.factory,
}));

import { createSearchWorkerClient } from "../searchWorkerClient";
import type { SearchWorkerToMainMessage } from "../searchWorkerTypes";

interface WorkerDouble {
	onmessage: ((event: MessageEvent<SearchWorkerToMainMessage>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
}

describe("createSearchWorkerClient", () => {
	const originalWorker = globalThis.Worker;

	beforeEach(() => {
		workerHarness.factory.mockReset();
		workerHarness.postMessage.mockReset();
		workerHarness.terminate.mockReset();
		workerHarness.factory.mockReturnValue({
			onmessage: null,
			onerror: null,
			postMessage: workerHarness.postMessage,
			terminate: workerHarness.terminate,
		});
		Reflect.set(globalThis, "Worker", function WorkerMock() {});
	});

	afterEach(() => {
		Reflect.set(globalThis, "Worker", originalWorker);
	});

	it("does not create a worker until the first message is sent", () => {
		const client = createSearchWorkerClient(vi.fn());

		expect(workerHarness.factory).not.toHaveBeenCalled();
		client.syncItems({ datasetVersion: 1, items: [] });
		expect(workerHarness.factory).toHaveBeenCalledOnce();

		client.syncItems({ datasetVersion: 2, items: [] });
		client.filter({
			requestId: 1,
			datasetVersion: 2,
			query: "alpha",
			matchScope: "title-only",
		});
		expect(workerHarness.factory).toHaveBeenCalledOnce();
	});

	it("posts sync messages before the corresponding filter message", () => {
		const client = createSearchWorkerClient(vi.fn());

		client.syncItems({
			datasetVersion: 1,
			items: [
				{
					key: "beta",
					searchText: "beta title",
					targetFilePath: "notes/beta.md",
				},
			],
		});
		client.upsertFileContents({
			datasetVersion: 2,
			entries: [
				{
					path: "notes/beta.md",
					content: "body contains beta",
				},
			],
		});
		client.filter({
			requestId: 1,
			datasetVersion: 2,
			query: "beta",
			matchScope: "title-and-content",
		});

		expect(
			workerHarness.postMessage.mock.calls.map(([message]) => message.type),
		).toEqual(["sync-items", "upsert-file-contents", "filter"]);
	});

	it("forwards worker messages without retaining search state", () => {
		const messages: SearchWorkerToMainMessage[] = [];
		const client = createSearchWorkerClient((message) => messages.push(message));
		client.syncItems({ datasetVersion: 1, items: [] });

		const worker = workerHarness.factory.mock.results[0].value as WorkerDouble;
		const response: SearchWorkerToMainMessage = {
			type: "filter-result",
			requestId: 3,
			datasetVersion: 1,
			matchedItems: [{ key: "alpha", contentMatched: false }],
		};
		worker.onmessage?.({
			data: response,
		} as MessageEvent<SearchWorkerToMainMessage>);

		expect(messages).toEqual([response]);
	});

	it("reports worker errors and does not run fallback filtering", () => {
		const messages: SearchWorkerToMainMessage[] = [];
		const client = createSearchWorkerClient((message) => messages.push(message));
		client.syncItems({ datasetVersion: 1, items: [] });

		const failedWorker = workerHarness.factory.mock.results[0]
			.value as WorkerDouble;
		failedWorker.onerror?.({ message: "worker crashed" } as ErrorEvent);

		expect(workerHarness.terminate).toHaveBeenCalledTimes(1);
		expect(messages).toEqual([{ type: "error", message: "worker crashed" }]);

		client.filter({
			requestId: 2,
			datasetVersion: 1,
			query: "alpha",
			matchScope: "title-only",
		});

		expect(messages).toEqual([
			{ type: "error", message: "worker crashed" },
			{ type: "error", message: "Search worker is unavailable." },
		]);
	});

	it("can terminate safely before initialization", () => {
		const client = createSearchWorkerClient(vi.fn());

		expect(() => client.terminate()).not.toThrow();
		expect(workerHarness.factory).not.toHaveBeenCalled();
		expect(workerHarness.terminate).not.toHaveBeenCalled();
	});
});
