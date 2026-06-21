export function createAbortError(): DOMException | Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Preview request aborted", "AbortError");
	}

	const error = new Error("Preview request aborted");
	error.name = "AbortError";
	return error;
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";
}
