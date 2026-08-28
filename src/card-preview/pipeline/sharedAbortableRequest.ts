import { createAbortError, isAbortError } from "./previewAbort";

/** In-flight work shared by independently abortable callers. */
export interface SharedAbortableRequest<T> {
	callerCount: number;
	readonly controller: AbortController;
	readonly promise: Promise<T>;
}

/** Creates shared work whose lifetime is controlled by attached callers. */
export function createSharedAbortableRequest<T>(
	start: (signal: AbortSignal) => Promise<T>,
): SharedAbortableRequest<T> {
	const controller = new AbortController();
	return {
		callerCount: 0,
		controller,
		promise: start(controller.signal),
	};
}

/** Attaches one caller without allowing its abort to cancel other callers. */
export function attachSharedCaller<T>(
	request: SharedAbortableRequest<T>,
	signal?: AbortSignal,
	abortMessage?: string,
): Promise<T> {
	if (signal?.aborted || request.controller.signal.aborted) {
		return Promise.reject(createAbortError(abortMessage));
	}

	request.callerCount += 1;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let onAbort = () => {};
		const settle = (handler: () => void): void => {
			if (settled) return;
			settled = true;
			if (signal) signal.removeEventListener("abort", onAbort);
			releaseSharedCaller(request);
			handler();
		};

		onAbort = () => settle(() => reject(createAbortError(abortMessage)));
		if (signal) signal.addEventListener("abort", onAbort, { once: true });

		request.promise.then(
			(value) => {
				if (signal?.aborted) {
					settle(() => reject(createAbortError(abortMessage)));
					return;
				}
				settle(() => resolve(value));
			},
			(error: unknown) => {
				if (signal?.aborted && !isAbortError(error)) {
					settle(() => reject(createAbortError(abortMessage)));
					return;
				}
				settle(() => reject(error));
			},
		);
	});
}

function releaseSharedCaller<T>(request: SharedAbortableRequest<T>): void {
	request.callerCount = Math.max(request.callerCount - 1, 0);
	if (request.callerCount === 0) request.controller.abort();
}
