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

export function createFrameScheduler(
	isUnloaded: () => boolean,
): FrameScheduler {
	const animationFrameIds = new Set<number>();
	const idleCallbackIds = new Set<number>();
	const timeoutIds = new Set<number>();
	let isDestroyed = false;

	function shouldSkipCallback(): boolean {
		return isDestroyed || isUnloaded();
	}

	function runIfActive(callback: FrameSchedulerCallback): void {
		if (shouldSkipCallback()) {
			return;
		}
		callback();
	}

	function scheduleTimeout(
		callback: FrameSchedulerCallback,
		timeout: number,
	): void {
		let timeoutId = 0;
		timeoutId = window.setTimeout(() => {
			timeoutIds.delete(timeoutId);
			runIfActive(callback);
		}, timeout);
		timeoutIds.add(timeoutId);
	}

	function scheduleOnNextFrame(callback: FrameSchedulerCallback): void {
		if (shouldSkipCallback()) {
			return;
		}

		if (typeof window.requestAnimationFrame === "function") {
			let animationFrameId = 0;
			animationFrameId = window.requestAnimationFrame(() => {
				animationFrameIds.delete(animationFrameId);
				runIfActive(callback);
			});
			animationFrameIds.add(animationFrameId);
			return;
		}

		scheduleTimeout(callback, 0);
	}

	function scheduleAfterFirstPaint(callback: FrameSchedulerCallback): void {
		scheduleOnNextFrame(() => scheduleOnNextFrame(callback));
	}

	function scheduleIdleOrNextFrame(
		callback: FrameSchedulerCallback,
		options?: IdleRequestOptions,
	): void {
		if (shouldSkipCallback()) {
			return;
		}

		if (typeof window.requestIdleCallback === "function") {
			let idleCallbackId = 0;
			idleCallbackId = window.requestIdleCallback(() => {
				idleCallbackIds.delete(idleCallbackId);
				runIfActive(callback);
			}, options);
			idleCallbackIds.add(idleCallbackId);
			return;
		}

		scheduleOnNextFrame(callback);
	}

	function destroy(): void {
		isDestroyed = true;

		animationFrameIds.forEach((animationFrameId) =>
			window.cancelAnimationFrame(animationFrameId),
		);
		animationFrameIds.clear();

		if (typeof window.cancelIdleCallback === "function") {
			idleCallbackIds.forEach((idleCallbackId) =>
				window.cancelIdleCallback(idleCallbackId),
			);
		}
		idleCallbackIds.clear();

		timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
		timeoutIds.clear();
	}

	return {
		scheduleOnNextFrame,
		scheduleAfterFirstPaint,
		scheduleIdleOrNextFrame,
		destroy,
	};
}
