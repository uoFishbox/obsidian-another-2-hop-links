export function createResolveAbortError(): DOMException | Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Two-hop resolve aborted", "AbortError");
	}

	const error = new Error("Two-hop resolve aborted");
	error.name = "AbortError";
	return error;
}

export function throwIfResolveAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw createResolveAbortError();
	}
}
