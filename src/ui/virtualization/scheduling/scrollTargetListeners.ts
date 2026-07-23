import { getOptionalOwnerWindow } from "ui/shared/dom/realmSafeDom";

type ScrollTarget = Window | HTMLElement;
type ScrollEndTarget = Document | HTMLElement;
export type ScrollPhase = "start" | "scroll" | "idle";
export interface ScrollTargetMetrics {
	readonly scrollTop: number;
	/** Monotonic generation of the latest published scroll frame. */
	readonly scrollGeneration: number;
}

interface MutableScrollTargetMetrics {
	scrollTop: number;
	scrollGeneration: number;
}

type ScrollPhaseCallback = (phase: ScrollPhase, metrics?: ScrollTargetMetrics) => void;

const SCROLL_IDLE_MS = 140;

interface Entry {
	phaseCallbacks: Set<ScrollPhaseCallback>;
	dispatch: () => void;
	dispatchFrame: () => void;
	dispatchIdle: () => void;
	dispatchScrollEnd: () => void;
	frameHandle: number | null;
	idleTimer: number | null;
	isScrollActive: boolean;
	lastScrollTime: number;
	metricsScratch: MutableScrollTargetMetrics;
	scrollEndPending: boolean;
	scrollEndTarget: ScrollEndTarget | null;
}

const entries = new WeakMap<ScrollTarget, Entry>();

function resolveScrollTargetWindow(target: ScrollTarget): Window | null {
	if ("document" in target) {
		return target;
	}

	return getOptionalOwnerWindow(target);
}

function readScrollTop(target: ScrollTarget): number {
	if ("document" in target) {
		return target.scrollY || target.pageYOffset || 0;
	}

	return target.scrollTop;
}

function resolveScrollEndTarget(target: ScrollTarget): ScrollEndTarget | null {
	const eventTarget = "document" in target ? target.document : target;
	return "onscrollend" in eventTarget ? eventTarget : null;
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
		const scrollEndTarget = resolveScrollEndTarget(target);
		entry = {
			phaseCallbacks: new Set(),
			frameHandle: null,
			idleTimer: null,
			isScrollActive: false,
			lastScrollTime: 0,
			metricsScratch: {
				scrollTop: 0,
				scrollGeneration: 0,
			},
			scrollEndPending: false,
			scrollEndTarget,
			dispatchIdle: () => {
				if (entry!.frameHandle !== null) {
					entry!.idleTimer = targetWindow.setTimeout(
						entry!.dispatchIdle,
						SCROLL_IDLE_MS,
					);
					return;
				}

				const elapsed = Date.now() - entry!.lastScrollTime;
				if (elapsed < SCROLL_IDLE_MS) {
					entry!.idleTimer = targetWindow.setTimeout(
						entry!.dispatchIdle,
						SCROLL_IDLE_MS - elapsed,
					);
					return;
				}

				entry!.idleTimer = null;
				entry!.isScrollActive = false;
				for (const cb of entry!.phaseCallbacks) {
					cb("idle");
				}
			},
			dispatchScrollEnd: () => {
				if (!entry!.isScrollActive && entry!.frameHandle === null) {
					return;
				}
				if (entry!.frameHandle !== null) {
					entry!.scrollEndPending = true;
					return;
				}

				entry!.isScrollActive = false;
				for (const cb of entry!.phaseCallbacks) {
					cb("idle");
				}
			},
			dispatchFrame: () => {
				entry!.frameHandle = null;
				entry!.metricsScratch.scrollTop = readScrollTop(target);
				entry!.metricsScratch.scrollGeneration += 1;
				if (entry!.scrollEndTarget === null) {
					entry!.lastScrollTime = Date.now();
				}
				if (!entry!.isScrollActive) {
					entry!.isScrollActive = true;
					for (const cb of entry!.phaseCallbacks) {
						cb("start");
					}
				}

				for (const cb of entry!.phaseCallbacks) {
					cb("scroll", entry!.metricsScratch);
				}

				if (entry!.scrollEndPending) {
					entry!.scrollEndPending = false;
					entry!.dispatchScrollEnd();
				} else if (
					entry!.scrollEndTarget === null &&
					entry!.idleTimer === null
				) {
					entry!.idleTimer = targetWindow.setTimeout(
						entry!.dispatchIdle,
						SCROLL_IDLE_MS,
					);
				}
			},
			dispatch: () => {
				entry!.scrollEndPending = false;
				if (entry!.frameHandle !== null) {
					return;
				}

				entry!.frameHandle = targetWindow.requestAnimationFrame(
					entry!.dispatchFrame,
				);
			},
		};

		entries.set(target, entry);
		target.addEventListener("scroll", entry.dispatch, {
			passive: true,
		});
		scrollEndTarget?.addEventListener("scrollend", entry.dispatchScrollEnd, {
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
			if (current.frameHandle !== null) {
				targetWindow.cancelAnimationFrame(current.frameHandle);
			}
			if (current.idleTimer !== null) {
				targetWindow.clearTimeout(current.idleTimer);
			}
			target.removeEventListener("scroll", current.dispatch);
			current.scrollEndTarget?.removeEventListener(
				"scrollend",
				current.dispatchScrollEnd,
			);
			entries.delete(target);
		}
	};
}
