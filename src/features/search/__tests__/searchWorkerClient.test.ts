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

	it("can terminate safely before initialization", () => {
		const client = createSearchWorkerClient(vi.fn());

		expect(() => client.terminate()).not.toThrow();
		expect(workerHarness.factory).not.toHaveBeenCalled();
		expect(workerHarness.terminate).not.toHaveBeenCalled();
	});

	it("terminates a failed worker and filters from the retained snapshot", async () => {
		const messages: SearchWorkerToMainMessage[] = [];
		const client = createSearchWorkerClient((message) => messages.push(message));
		client.syncItems({
			datasetVersion: 2,
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
					content: "Body contains the recovery token",
					mtime: 1,
				},
			],
		});
		client.filter({
			requestId: 1,
			datasetVersion: 2,
			query: "recovery token",
			matchScope: "title-and-content",
		});

		const failedWorker = workerHarness.factory.mock.results[0]
			.value as WorkerDouble;
		failedWorker.onerror?.({ message: "worker crashed" } as ErrorEvent);

		expect(workerHarness.terminate).toHaveBeenCalledTimes(1);
		expect(messages).toEqual([{ type: "error", message: "worker crashed" }]);

		client.filter({
			requestId: 2,
			datasetVersion: 2,
			query: "recovery token",
			matchScope: "title-and-content",
		});

		await vi.waitFor(() => {
			expect(messages).toHaveLength(2);
		});
		expect(messages[1]).toEqual({
			type: "filter-result",
			requestId: 2,
			datasetVersion: 2,
			matchedItems: [
				{
					key: "beta",
					titleMatched: false,
					contentMatched: true,
				},
			],
		});
		expect(workerHarness.postMessage).toHaveBeenCalledTimes(3);
	});
});
