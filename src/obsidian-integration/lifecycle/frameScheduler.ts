type FrameSchedulerCallback = () => void;

export interface FrameScheduler {
	scheduleOnNextFrame(callback: FrameSchedulerCallback): void;
	scheduleAfterFirstPaint(callback: FrameSchedulerCallback): void;
	scheduleIdleOrNextFrame(
		callback: FrameSchedulerCallback,
		options?: IdleRequestOptions,
	): void;
	destroy(): void;
}

interface ScheduledHandle {
	readonly id: number;
	readonly ownerWindow: Window;
}

export function createFrameScheduler(
	isUnloaded: () => boolean,
	getWindow: () => Window | null = () =>
		typeof window === "undefined" ? null : window,
): FrameScheduler {
	const animationFrameHandles = new Set<ScheduledHandle>();
	const idleCallbackHandles = new Set<ScheduledHandle>();
	const timeoutHandles = new Set<ScheduledHandle>();
	let isDestroyed = false;

	function shouldSkipCallback(): boolean {
		return isDestroyed || isUnloaded();
	}

	function runIfActive(callback: FrameSchedulerCallback): void {
		if (shouldSkipCallback()) return;
		callback();
	}

	function deleteHandle(
		handles: Set<ScheduledHandle>,
		ownerWindow: Window,
		id: number,
	): void {
		for (const handle of handles) {
			if (handle.ownerWindow === ownerWindow && handle.id === id) {
				handles.delete(handle);
				return;
			}
		}
	}

	function scheduleTimeoutOnWindow(
		ownerWindow: Window,
		callback: FrameSchedulerCallback,
		timeout: number,
	): void {
		let timeoutId = 0;
		timeoutId = ownerWindow.setTimeout(() => {
			deleteHandle(timeoutHandles, ownerWindow, timeoutId);
			runIfActive(callback);
		}, timeout);
		timeoutHandles.add({ id: timeoutId, ownerWindow });
	}

	function scheduleFrameOnWindow(
		ownerWindow: Window,
		callback: FrameSchedulerCallback,
	): void {
		if (typeof ownerWindow.requestAnimationFrame === "function") {
			let animationFrameId = 0;
			animationFrameId = ownerWindow.requestAnimationFrame(() => {
				deleteHandle(animationFrameHandles, ownerWindow, animationFrameId);
				runIfActive(callback);
			});
			animationFrameHandles.add({ id: animationFrameId, ownerWindow });
			return;
		}

		scheduleTimeoutOnWindow(ownerWindow, callback, 0);
	}

	function scheduleOnNextFrame(callback: FrameSchedulerCallback): void {
		if (shouldSkipCallback()) return;
		const ownerWindow = getWindow();
		if (!ownerWindow) {
			if (!shouldSkipCallback()) callback();
			return;
		}
		scheduleFrameOnWindow(ownerWindow, callback);
	}

	function scheduleAfterFirstPaint(callback: FrameSchedulerCallback): void {
		if (shouldSkipCallback()) return;
		const ownerWindow = getWindow();
		if (!ownerWindow) {
			if (!shouldSkipCallback()) callback();
			return;
		}

		// Keep both frames in the same realm. If focus migrates between frames,
		// cancellation and paint ordering still belong to the originating window.
		scheduleFrameOnWindow(ownerWindow, () =>
			scheduleFrameOnWindow(ownerWindow, callback),
		);
	}

	function scheduleIdleOrNextFrame(
		callback: FrameSchedulerCallback,
		options?: IdleRequestOptions,
	): void {
		if (shouldSkipCallback()) return;
		const ownerWindow = getWindow();
		if (!ownerWindow) {
			if (!shouldSkipCallback()) callback();
			return;
		}

		if (typeof ownerWindow.requestIdleCallback === "function") {
			let idleCallbackId = 0;
			idleCallbackId = ownerWindow.requestIdleCallback(() => {
				deleteHandle(idleCallbackHandles, ownerWindow, idleCallbackId);
				runIfActive(callback);
			}, options);
			idleCallbackHandles.add({ id: idleCallbackId, ownerWindow });
			return;
		}

		scheduleFrameOnWindow(ownerWindow, callback);
	}

	function destroy(): void {
		isDestroyed = true;

		for (const { ownerWindow, id } of animationFrameHandles) {
			ownerWindow.cancelAnimationFrame(id);
		}
		animationFrameHandles.clear();

		for (const { ownerWindow, id } of idleCallbackHandles) {
			if (typeof ownerWindow.cancelIdleCallback === "function") {
				ownerWindow.cancelIdleCallback(id);
			}
		}
		idleCallbackHandles.clear();

		for (const { ownerWindow, id } of timeoutHandles) {
			ownerWindow.clearTimeout(id);
		}
		timeoutHandles.clear();
	}

	return {
		scheduleOnNextFrame,
		scheduleAfterFirstPaint,
		scheduleIdleOrNextFrame,
		destroy,
	};
}
