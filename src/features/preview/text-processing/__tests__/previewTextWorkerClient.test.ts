import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	PreviewTextWorkerRequest,
	PreviewTextWorkerResponse,
} from "../previewTextWorkerTypes";

class FakePreviewTextWorker {
	onmessage: ((event: MessageEvent<PreviewTextWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	postedMessages: PreviewTextWorkerRequest[] = [];

	postMessage(message: PreviewTextWorkerRequest): void {
		this.postedMessages.push(message);
	}

	emitMessage(message: PreviewTextWorkerResponse): void {
		this.onmessage?.({ data: message } as MessageEvent<PreviewTextWorkerResponse>);
	}
}

const state = vi.hoisted((): { worker: FakePreviewTextWorker | null } => ({
	worker: null,
}));

vi.mock("../previewTextProcessing.worker", () => ({
	default: () => state.worker,
}));

describe("preview text worker client", () => {
	beforeEach(() => {
		vi.resetModules();
		state.worker = new FakePreviewTextWorker();
		vi.stubGlobal("Worker", class WorkerStub {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("sends cancel message when an active request is aborted", async () => {
		const { runPreviewTextWorker } = await import("../previewTextWorkerClient");
		const abortController = new AbortController();

		const promise = runPreviewTextWorker(
			{
				type: "highlight-html",
				content: "x".repeat(50000),
				searchQuery: "x",
			},
			abortController.signal,
		);

		expect(promise).toBeDefined();
		abortController.abort();

		await expect(promise as Promise<unknown>).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(state.worker?.postedMessages).toEqual([
			expect.objectContaining({
				type: "highlight-html",
				requestId: 1,
			}),
			{ type: "cancel", requestId: 1 },
		]);
	});

	test("ignores a result returned after cancellation", async () => {
		const { runPreviewTextWorker } = await import("../previewTextWorkerClient");
		const abortController = new AbortController();

		const promise = runPreviewTextWorker(
			{
				type: "highlight-html",
				content: "x".repeat(50000),
				searchQuery: "x",
			},
			abortController.signal,
		);

		abortController.abort();
		state.worker?.emitMessage({
			type: "result",
			requestId: 1,
			result: "late-result",
		});

		await expect(promise as Promise<unknown>).rejects.toMatchObject({
			name: "AbortError",
		});
	});
});
