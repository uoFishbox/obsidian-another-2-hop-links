export function createAbortError(
	message = "Preview request aborted",
): DOMException | Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException(message, "AbortError");
	}

	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

export function throwIfAborted(
	signal: AbortSignal | undefined,
	message = "Preview request aborted",
): void {
	if (signal?.aborted) {
		throw createAbortError(message);
	}
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";
}
