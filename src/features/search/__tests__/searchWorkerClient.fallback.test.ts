import { describe, expect, it, vi } from "vitest";
import { createSearchWorkerClient } from "../searchWorkerClient";
import type { SearchWorkerFilterTimeSlicedOptions } from "../searchWorkerFilter";
import type { SearchWorkerToMainMessage } from "../searchWorkerTypes";

const filterHarness = vi.hoisted(() => {
	const pendingResolvers: Array<() => void> = [];
	let callCount = 0;

	return {
		getCallCount() {
			return callCount;
		},
		resolveNext() {
			pendingResolvers.shift()?.();
		},
		reset() {
			pendingResolvers.length = 0;
			callCount = 0;
		},
		async filter(options: SearchWorkerFilterTimeSlicedOptions) {
			callCount += 1;
			const callIndex = callCount;

			if (callIndex === 1) {
				await new Promise<void>((resolve) => {
					pendingResolvers.push(resolve);
				});
			}

			if (options.isCancelled?.()) {
				return;
			}

			options.onMatch({
				key: callIndex === 1 ? "alpha" : "beta",
				titleMatched: true,
				contentMatched: false,
			});
		},
	};
});

vi.mock("../searchWorkerFilter", async () => {
	const actual = await vi.importActual<typeof import("../searchWorkerFilter")>(
		"../searchWorkerFilter",
	);

	return {
		...actual,
		filterSearchWorkerDatasetWithMatchDetailsTimeSliced: filterHarness.filter,
	};
});

vi.mock("../searchFilter.worker", () => ({
	default: () => {
		throw new Error("Worker factory should not be called in fallback tests.");
	},
}));

describe("createSearchWorkerClient fallback", () => {
	it("does not emit stale fallback filter results after a newer filter", async () => {
		const originalWorker = globalThis.Worker;
		Reflect.set(globalThis, "Worker", undefined);
		filterHarness.reset();
		const messages: SearchWorkerToMainMessage[] = [];

		try {
			const client = createSearchWorkerClient((message) => {
				messages.push(message);
			});
			client.syncItems({
				datasetVersion: 1,
				items: [],
			});

			client.filter({
				requestId: 1,
				datasetVersion: 1,
				query: "alpha",
			});
			client.filter({
				requestId: 2,
				datasetVersion: 1,
				query: "beta",
			});

			await vi.waitFor(() => {
				expect(messages).toHaveLength(1);
			});
			filterHarness.resolveNext();
			await Promise.resolve();

			expect(messages).toEqual([
				{
					type: "filter-result",
					requestId: 2,
					datasetVersion: 1,
					matchedItems: [
						{
							key: "beta",
							titleMatched: true,
							contentMatched: false,
						},
					],
				},
			]);
		} finally {
			Reflect.set(globalThis, "Worker", originalWorker);
		}
	});
});
