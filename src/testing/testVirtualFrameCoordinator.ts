import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "shared/ui/scheduling/frameCoordinator";

interface ScheduledHandle {
	readonly kind: "animation-frame" | "timeout";
	readonly id: number;
}

/** Minimal keyed frame coordinator for scheduler tests outside a DOM realm. */
export function createTestVirtualFrameCoordinator(): VirtualFrameCoordinator {
	const queues: Record<VirtualFrameLane, Map<string, () => void>> = {
		"animation-frame": new Map(),
		"scroll-critical": new Map(),
		"post-paint": new Map(),
		idle: new Map(),
	};
	const handles: Record<VirtualFrameLane, ScheduledHandle | null> = {
		"animation-frame": null,
		"scroll-critical": null,
		"post-paint": null,
		idle: null,
	};
	let disposed = false;

	function drain(lane: VirtualFrameLane): void {
		handles[lane] = null;
		const tasks = Array.from(queues[lane].values());
		queues[lane].clear();
		for (const task of tasks) task();
		if (queues[lane].size > 0) scheduleDrain(lane);
	}

	function scheduleDrain(lane: VirtualFrameLane): void {
		if (disposed || handles[lane] !== null) return;
		const afterFrame = (): void => {
			handles[lane] = null;
			if (lane === "post-paint") {
				const id = globalThis.setTimeout(
					() => drain(lane),
					0,
				) as unknown as number;
				handles[lane] = { kind: "timeout", id };
				return;
			}
			drain(lane);
		};
		if (typeof globalThis.requestAnimationFrame === "function") {
			const id = globalThis.requestAnimationFrame(afterFrame);
			handles[lane] = { kind: "animation-frame", id };
			return;
		}
		const id = globalThis.setTimeout(afterFrame, 1000 / 60) as unknown as number;
		handles[lane] = { kind: "timeout", id };
	}

	function cancelLaneHandle(lane: VirtualFrameLane): void {
		const handle = handles[lane];
		if (!handle) return;
		if (
			handle.kind === "animation-frame" &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(handle.id);
		} else {
			globalThis.clearTimeout(handle.id);
		}
		handles[lane] = null;
	}

	return {
		schedule(lane, key, task): boolean {
			if (disposed || queues[lane].has(key)) return false;
			queues[lane].set(key, task);
			scheduleDrain(lane);
			return true;
		},
		cancel(lane, key): void {
			queues[lane].delete(key);
			if (queues[lane].size === 0) cancelLaneHandle(lane);
		},
		isScheduled: (lane, key) => queues[lane].has(key),
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const lane of Object.keys(queues) as VirtualFrameLane[]) {
				cancelLaneHandle(lane);
				queues[lane].clear();
			}
		},
	};
}
