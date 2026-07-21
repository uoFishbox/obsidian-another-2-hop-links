import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

const FALLBACK_FRAME_INTERVAL_MS = 1000 / 60;

export interface PreviewFrameDriver {
	cancel(): void;
	dispose(): void;
	isScheduled(): boolean;
	schedule(): void;
}

export interface CreatePreviewFrameDriverOptions {
	readonly coordinator?: VirtualFrameCoordinator;
	readonly taskKey: string;
	readonly onAnimationFrameScheduled?: () => void;
	readonly onFrame: (timestamp: number) => void;
}

export function readPreviewSchedulingTime(): number {
	if (typeof globalThis.performance?.now === "function") {
		return globalThis.performance.now();
	}
	return Date.now();
}

/**
 * Creates a single-task frame driver backed by a virtual surface coordinator,
 * requestAnimationFrame, or a timeout fallback.
 */
export function createPreviewFrameDriver(
	options: CreatePreviewFrameDriverOptions,
): PreviewFrameDriver {
	let frameHandle: number | null = null;
	let frameHandleKind: "animation-frame" | "timeout" | null = null;
	let coordinatorScheduled = false;
	let disposed = false;

	function isScheduled(): boolean {
		return coordinatorScheduled || frameHandle !== null;
	}

	function runFrame(timestamp: number): void {
		if (disposed) return;
		options.onFrame(timestamp);
	}

	function schedule(): void {
		if (disposed || isScheduled()) return;

		if (options.coordinator) {
			const scheduled = options.coordinator.schedule(
				"idle",
				options.taskKey,
				() => {
					coordinatorScheduled = false;
					runFrame(readPreviewSchedulingTime());
				},
			);
			if (scheduled) {
				coordinatorScheduled = true;
				return;
			}
		}

		if (typeof globalThis.requestAnimationFrame === "function") {
			options.onAnimationFrameScheduled?.();
			frameHandleKind = "animation-frame";
			frameHandle = globalThis.requestAnimationFrame((timestamp) => {
				frameHandle = null;
				frameHandleKind = null;
				runFrame(timestamp);
			});
			return;
		}

		if (typeof globalThis.setTimeout !== "function") return;
		frameHandleKind = "timeout";
		frameHandle = globalThis.setTimeout(() => {
			frameHandle = null;
			frameHandleKind = null;
			runFrame(readPreviewSchedulingTime());
		}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
	}

	function cancel(): void {
		if (coordinatorScheduled && options.coordinator) {
			options.coordinator.cancel("idle", options.taskKey);
			coordinatorScheduled = false;
		}
		if (frameHandle === null) return;

		if (
			frameHandleKind === "animation-frame" &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(frameHandle);
		} else if (typeof globalThis.clearTimeout === "function") {
			globalThis.clearTimeout(frameHandle);
		}
		frameHandle = null;
		frameHandleKind = null;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		cancel();
	}

	return { cancel, dispose, isScheduled, schedule };
}
