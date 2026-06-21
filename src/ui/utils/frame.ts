export function nextAnimationFrame(): Promise<void> {
	return new Promise<void>((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => resolve());
			return;
		}

		globalThis.setTimeout(resolve, 0);
	});
}

export function scheduleAnimationFrame(callback: () => void): () => void {
	if (typeof requestAnimationFrame === "function") {
		const frameId = requestAnimationFrame(() => callback());
		return () => cancelAnimationFrame(frameId);
	}

	const timeoutId = globalThis.setTimeout(callback, 0);
	return () => globalThis.clearTimeout(timeoutId);
}

export const waitForNextAnimationFrame = nextAnimationFrame;
