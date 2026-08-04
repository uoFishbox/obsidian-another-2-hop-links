import { afterEach, describe, expect, test, vi } from "vitest";
import type {
	PreviewTextWorkerRequest,
	PreviewTextWorkerResponse,
} from "../previewTextWorkerTypes";

interface FakeWorkerGlobalScope {
	onmessage: ((event: MessageEvent<PreviewTextWorkerRequest>) => void) | null;
}

interface WorkerHarness {
	self: FakeWorkerGlobalScope;
	postMessageSpy: ReturnType<
		typeof vi.fn<(message: PreviewTextWorkerResponse) => void>
	>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function loadWorkerHarness(): Promise<WorkerHarness> {
	const fakeSelf: FakeWorkerGlobalScope = { onmessage: null };
	const postMessageSpy = vi.fn<(message: PreviewTextWorkerResponse) => void>();
	vi.stubGlobal("self", fakeSelf);
	vi.stubGlobal("postMessage", postMessageSpy);
	vi.stubGlobal("close", vi.fn());

	await import("../previewTextProcessing.worker");
	return { self: fakeSelf, postMessageSpy };
}

function dispatchWorkerMessage(
	self: FakeWorkerGlobalScope,
	message: PreviewTextWorkerRequest,
): void {
	self.onmessage?.({ data: message } as MessageEvent<PreviewTextWorkerRequest>);
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("preview text processing worker", () => {
	afterEach(() => {
		vi.doUnmock("../searchHighlighter");
		vi.unstubAllGlobals();
	});

	test("processes synchronous requests without timer delay", async () => {
		vi.resetModules();
		const { self, postMessageSpy } = await loadWorkerHarness();

		dispatchWorkerMessage(self, {
			type: "highlight-html",
			requestId: 1,
			content: "target",
			searchQuery: "target",
		});

		expect(postMessageSpy).toHaveBeenCalledTimes(1);
		expect(postMessageSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "result",
				requestId: 1,
			}),
		);
	});

	test("cancels a queued request while another request is processing", async () => {
		vi.resetModules();
		const firstRequest = createDeferred<string>();
		const highlightSearchMatchesInHtml = vi.fn(() => firstRequest.promise);
		vi.doMock("../searchHighlighter", () => ({
			highlightSearchMatchesInHtml,
		}));
		const { self, postMessageSpy } = await loadWorkerHarness();

		dispatchWorkerMessage(self, {
			type: "highlight-html",
			requestId: 1,
			content: "first",
			searchQuery: "first",
		});
		dispatchWorkerMessage(self, {
			type: "highlight-html",
			requestId: 2,
			content: "second",
			searchQuery: "second",
		});
		dispatchWorkerMessage(self, { type: "cancel", requestId: 2 });

		firstRequest.resolve("first-result");
		await flushPromises();

		expect(postMessageSpy).toHaveBeenCalledTimes(1);
		expect(postMessageSpy).toHaveBeenCalledWith({
			type: "result",
			requestId: 1,
			result: "first-result",
		});
		expect(highlightSearchMatchesInHtml).toHaveBeenCalledTimes(1);
	});
});
