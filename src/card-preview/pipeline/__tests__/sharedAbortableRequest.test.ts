import { describe, expect, it } from "vitest";
import {
	attachSharedCaller,
	createSharedAbortableRequest,
} from "../sharedAbortableRequest";

function createDeferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

describe("sharedAbortableRequest", () => {
	it("keeps shared work alive while another caller remains", async () => {
		const deferred = createDeferred<string>();
		let sharedSignal: AbortSignal | undefined;
		const request = createSharedAbortableRequest((signal) => {
			sharedSignal = signal;
			return deferred.promise;
		});
		const firstController = new AbortController();
		const first = attachSharedCaller(request, firstController.signal);
		const second = attachSharedCaller(request);

		firstController.abort();

		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(sharedSignal?.aborted).toBe(false);

		deferred.resolve("shared");

		await expect(second).resolves.toBe("shared");
		expect(sharedSignal?.aborted).toBe(true);
	});

	it("aborts shared work when its only caller aborts", async () => {
		const deferred = createDeferred<string>();
		let sharedSignal: AbortSignal | undefined;
		const request = createSharedAbortableRequest((signal) => {
			sharedSignal = signal;
			return deferred.promise;
		});
		const controller = new AbortController();
		const caller = attachSharedCaller(request, controller.signal, "Stopped");

		controller.abort();

		await expect(caller).rejects.toMatchObject({
			name: "AbortError",
			message: "Stopped",
		});
		expect(sharedSignal?.aborted).toBe(true);
	});

	it("preserves a non-abort failure from shared work", async () => {
		const failure = new Error("generation failed");
		const request = createSharedAbortableRequest(() => Promise.reject(failure));

		await expect(attachSharedCaller(request)).rejects.toBe(failure);
	});
});
