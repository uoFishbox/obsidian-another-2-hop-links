import { describe, expect, it, vi } from "vitest";

vi.mock("../searchFilter.worker", () => ({
	default: () => {
		throw new Error("Worker factory should not be called in unavailable tests.");
	},
}));

import { createSearchWorkerClient } from "../searchWorkerClient";
import type { SearchWorkerToMainMessage } from "../searchWorkerTypes";

describe("createSearchWorkerClient unavailable worker", () => {
	it("reports unavailable instead of filtering on the main thread", () => {
		const originalWorker = globalThis.Worker;
		Reflect.set(globalThis, "Worker", undefined);

		try {
			const messages: SearchWorkerToMainMessage[] = [];
			const client = createSearchWorkerClient((message) => {
				messages.push(message);
			});

			client.filter({
				requestId: 1,
				datasetVersion: 1,
				query: "alpha",
				matchScope: "title-only",
			});

			expect(messages).toEqual([
				{ type: "error", message: "Search worker is unavailable." },
			]);
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});
});
