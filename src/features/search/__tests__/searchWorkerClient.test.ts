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
});
