function resolveFrameWindow(targetWindow?: Window | null): Window | null {
	return targetWindow ?? (typeof window === "undefined" ? null : window);
}

export function nextAnimationFrame(targetWindow?: Window | null): Promise<void> {
	return new Promise<void>((resolve) => {
		const ownerWindow = resolveFrameWindow(targetWindow);
		if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
			ownerWindow.requestAnimationFrame(() => resolve());
			return;
		}

		if (ownerWindow) {
			ownerWindow.setTimeout(resolve, 0);
			return;
		}

		globalThis.setTimeout(resolve, 0);
	});
}

export function scheduleAnimationFrame(
	callback: () => void,
	targetWindow?: Window | null,
): () => void {
	const ownerWindow = resolveFrameWindow(targetWindow);
	if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
		const frameId = ownerWindow.requestAnimationFrame(() => callback());
		return () => ownerWindow.cancelAnimationFrame(frameId);
	}

	if (ownerWindow) {
		const timeoutId = ownerWindow.setTimeout(callback, 0);
		return () => ownerWindow.clearTimeout(timeoutId);
	}

	const timeoutId = globalThis.setTimeout(callback, 0);
	return () => globalThis.clearTimeout(timeoutId);
}

export interface ScheduledFrameTask {
	cancel(): void;
}

/** Schedules a cancellable callback after the requested number of layout frames. */
export function scheduleAfterAnimationFrames(
	targetWindow: Window | null,
	frameCount: number,
	callback: () => void,
): ScheduledFrameTask {
	let remainingFrames = Math.max(1, Math.floor(frameCount));
	let cancelFrame: (() => void) | null = null;
	let canceled = false;

	const scheduleNextFrame = (): void => {
		cancelFrame = scheduleAnimationFrame(() => {
			cancelFrame = null;
			if (canceled) return;

			remainingFrames -= 1;
			if (remainingFrames > 0) {
				scheduleNextFrame();
				return;
			}

			callback();
		}, targetWindow);
	};

	scheduleNextFrame();

	return {
		cancel(): void {
			if (canceled) return;
			canceled = true;
			cancelFrame?.();
			cancelFrame = null;
		},
	};
}

export const waitForNextAnimationFrame = nextAnimationFrame;
