import { getOptionalOwnerWindow } from "ui/utils/realmSafeDom";

type ScrollTarget = Window | HTMLElement;
export type ScrollPhase = "start" | "scroll" | "idle";
export interface ScrollTargetMetrics {
	scrollTop: number;
	clientHeight: number;
}

type ScrollPhaseCallback = (phase: ScrollPhase, metrics?: ScrollTargetMetrics) => void;

const SCROLL_IDLE_MS = 140;

interface Entry {
	phaseCallbacks: Set<ScrollPhaseCallback>;
	dispatch: () => void;
	dispatchIdle: () => void;
	idleTimer: number | null;
	isScrollActive: boolean;
}

const entries = new WeakMap<ScrollTarget, Entry>();

function resolveScrollTargetWindow(target: ScrollTarget): Window | null {
	if ("document" in target) {
		return target;
	}

	return getOptionalOwnerWindow(target);
}

function snapshotScrollTargetMetrics(
	target: ScrollTarget,
): ScrollTargetMetrics | undefined {
	if ("document" in target) {
		return undefined;
	}

	return {
		scrollTop: target.scrollTop,
		clientHeight: target.clientHeight,
	};
}

export function subscribeScrollTarget(
	target: ScrollTarget,
	callback: ScrollPhaseCallback,
): () => void {
	let entry = entries.get(target);
	const targetWindow = resolveScrollTargetWindow(target);
	if (!targetWindow) {
		return () => {};
	}

	if (!entry) {
		entry = {
			phaseCallbacks: new Set(),
			idleTimer: null,
			isScrollActive: false,
			dispatchIdle: () => {
				entry!.idleTimer = null;
				entry!.isScrollActive = false;
				for (const cb of entry!.phaseCallbacks) {
					cb("idle");
				}
			},
			dispatch: () => {
				const metrics = snapshotScrollTargetMetrics(target);
				if (!entry!.isScrollActive) {
					entry!.isScrollActive = true;
					for (const cb of entry!.phaseCallbacks) {
						cb("start");
					}
				}

				for (const cb of entry!.phaseCallbacks) {
					cb("scroll", metrics);
				}

				if (entry!.idleTimer !== null) {
					targetWindow.clearTimeout(entry!.idleTimer);
				}

				entry!.idleTimer = targetWindow.setTimeout(
					entry!.dispatchIdle,
					SCROLL_IDLE_MS,
				);
			},
		};

		entries.set(target, entry);
		target.addEventListener("scroll", entry.dispatch, {
			passive: true,
		});
	}

	entry.phaseCallbacks.add(callback);

	return () => {
		const current = entries.get(target);
		if (!current) {
			return;
		}

		current.phaseCallbacks.delete(callback);

		if (current.phaseCallbacks.size === 0) {
			if (current.idleTimer !== null) {
				targetWindow.clearTimeout(current.idleTimer);
			}
			target.removeEventListener("scroll", current.dispatch);
			entries.delete(target);
		}
	};
}
