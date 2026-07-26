import { Notice } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import { findNearestScrollContainerCached } from "ui/virtualization/dom/scrollContainer";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
	type CCLDevMeasurementSnapshot,
} from "./CCLDevMeasurements";

/** Class name that identifies the virtual list root element of `TwoHopSurface.svelte`. */
const TWO_HOP_VIRTUAL_LIST_SELECTOR = ".twohop-page-virtual-list";

/** Fixed number of frames aligned with the workload metrics in PERFORMANCE.md. */
const SCROLL_FRAMES = 600;
/** Fixed scroll distance per frame (px). Speed follows the frequency of `requestAnimationFrame`. */
const SCROLL_STEP_PX = 10;

/** Number of consecutive unchanged frames to determine that initial rendering and preview generation have settled. */
const SETTLE_QUIET_FRAMES = 30;
/** Maximum wait time for settling (ms). Upper bound to avoid infinite waiting. */
const MAX_SETTLE_WAIT_MS = 8000;

export function registerScrollBenchmarkCommand(plugin: PluginHost): void {
	let benchmarkPromise: Promise<void> | null = null;

	plugin.addCommand({
		id: "benchmark-two-hop-virtual-list-scroll",
		name: "Benchmark two-hop virtual list scroll (600 frames down/up)",
		callback: () => {
			void runBenchmark();
		},
	});

	async function runBenchmark(): Promise<void> {
		if (benchmarkPromise) {
			new Notice("Scroll benchmark is already running.");
			return;
		}

		const promise = executeBenchmark();
		benchmarkPromise = promise;

		try {
			await promise;
		} finally {
			if (benchmarkPromise === promise) {
				benchmarkPromise = null;
			}
		}
	}

	async function executeBenchmark(): Promise<void> {
		const scrollers = findTwoHopScrollers(plugin);
		if (scrollers.length === 0) {
			new Notice("No two-hop virtual list found to benchmark.");
			return;
		}

		new Notice(
			`Benchmarking two-hop virtual list scroll (${SCROLL_FRAMES} frames down/up, ${scrollers.length} scroller(s))...`,
		);

		try {
			await waitForRenderSettle();
			resetCCLDevMeasurements();

			await runScrollFrames(scrollers, 1);
			await runScrollFrames(scrollers, -1);
			// Idle detection is timer-based, so the final idle measurement lands
			// after the last scroll frame. Wait for it before taking the snapshot.
			await waitForRenderSettle();

			const measurements = getCCLDevMeasurementSnapshot();
			logCCLDevMeasurements(scrollers.length, measurements);
			new Notice(
				"Scroll benchmark completed. Check console for CCLDevMeasurements.",
			);
		} catch (error) {
			console.error("[Cosense card links] scroll benchmark failed:", error);
			new Notice("Scroll benchmark failed. Check console for details.");
		}
	}
}

function findTwoHopScrollers(plugin: PluginHost): HTMLElement[] {
	const roots = plugin.app.workspace.containerEl.querySelectorAll<HTMLElement>(
		TWO_HOP_VIRTUAL_LIST_SELECTOR,
	);

	const scrollers = new Set<HTMLElement>();
	for (const root of roots) {
		if (root.clientHeight === 0 && root.clientWidth === 0) {
			continue;
		}

		const scroller = findNearestScrollContainerCached(root);
		if (scroller) {
			scrollers.add(scroller);
		}
	}

	return Array.from(scrollers);
}

function sumMeasurementCounts(snapshot: CCLDevMeasurementSnapshot): number {
	let total = 0;
	for (const counter of Object.values(snapshot.counters)) {
		total += counter.count;
	}
	return total;
}

/**
 * Waits until initial rendering and preview generation have settled. Resolves when
 * the total of dev measurement counters has not changed for `SETTLE_QUIET_FRAMES`
 * consecutive frames, or when `MAX_SETTLE_WAIT_MS` has been exceeded.
 */
function waitForRenderSettle(): Promise<void> {
	return new Promise((resolve) => {
		const startedAt = performance.now();
		let quietStreak = 0;
		let lastTotal = sumMeasurementCounts(getCCLDevMeasurementSnapshot());

		function step(): void {
			const currentTotal = sumMeasurementCounts(getCCLDevMeasurementSnapshot());
			if (currentTotal === lastTotal) {
				quietStreak += 1;
			} else {
				quietStreak = 0;
				lastTotal = currentTotal;
			}

			const elapsedMs = performance.now() - startedAt;
			if (quietStreak >= SETTLE_QUIET_FRAMES || elapsedMs >= MAX_SETTLE_WAIT_MS) {
				resolve();
				return;
			}

			requestAnimationFrame(step);
		}

		requestAnimationFrame(step);
	});
}

/**
 * Performs scrolling at a fixed distance and fixed frame count. By reversing the
 * same step width between the outbound (down) and return (up) paths, it reproduces
 * a scroll that follows the same route.
 */
function runScrollFrames(
	scrollers: readonly HTMLElement[],
	direction: 1 | -1,
): Promise<void> {
	return new Promise((resolve) => {
		let framesDone = 0;

		function step(): void {
			for (const scroller of scrollers) {
				scroller.scrollTop = scroller.scrollTop + direction * SCROLL_STEP_PX;
			}

			framesDone += 1;
			if (framesDone >= SCROLL_FRAMES) {
				resolve();
				return;
			}

			requestAnimationFrame(step);
		}

		requestAnimationFrame(step);
	});
}

function logCCLDevMeasurements(
	scrollerCount: number,
	measurements: CCLDevMeasurementSnapshot,
): void {
	console.group("[Cosense card links] two-hop virtual list scroll benchmark");
	console.log("Summary", {
		scrollFrames: SCROLL_FRAMES,
		scrollStepPx: SCROLL_STEP_PX,
		scrollerCount,
		measurementsEnabled: measurements.enabled,
	});
	console.table(
		Object.entries(measurements.counters).map(([name, counter]) => ({
			name,
			count: counter.count,
			lastUpdatedAt: counter.lastUpdatedAt,
		})),
	);
	console.groupEnd();
}
