import { tick } from "svelte";
import {
	captureTwoHopLayoutAnchor,
	captureTwoHopScrollPosition,
	restoreTwoHopLayoutAnchor,
	restoreTwoHopScrollPosition,
	type TwoHopLayoutAnchor,
	type TwoHopLayoutAnchorMeasurement,
	type TwoHopScrollPosition,
} from "./layoutAnchor";
import type { TwoHopRowModel } from "./rowModel";

/**
 * Pending scroll target. Layout anchors and absolute positions are mutually
 * exclusive, so callers never have to reason about two independent fields.
 */
type PendingLayoutAnchor = {
	readonly kind: "layout-anchor";
	readonly anchor: TwoHopLayoutAnchor;
};

type PendingAbsolutePosition = {
	readonly kind: "absolute-position";
	readonly position: TwoHopScrollPosition;
};

type PendingScrollRestore = PendingLayoutAnchor | PendingAbsolutePosition;

export interface TwoHopAnchorRestorationParams {
	getRootEl(): HTMLElement | null;
	getRowModel(): TwoHopRowModel;
	getMeasurement(): TwoHopLayoutAnchorMeasurement;
	/** True while the virtualizer snapshot still shows a stale row model. */
	isRowModelCommitted(): boolean;
	scheduleLayoutMeasurement(): void;
	suppressNextNativeScroll(scrollTop: number): void;
	/** Re-measures the window after restoration; content may have shrunk. */
	runDataChangeMeasurement(): void;
}

export interface TwoHopAnchorRestorationController {
	/** Captures the first visible cell before a layout-preserving publication. */
	preserveAnchor(): void;
	/** Captures the absolute scroll offset before a result-set replacement. */
	preserveScrollPosition(): void;
	/** Drops a pending layout anchor, e.g. when the surface width collapses. */
	discardPendingAnchor(): void;
	/** Restores the pending target once the next snapshot is published. */
	scheduleAfterSnapshot(): void;
	/** Restores the pending target after the DOM commit of a publication. */
	restoreAfterCommit(): void;
	dispose(): void;
}

/**
 * Owns the post-layout scroll restoration state machine:
 * capture -> tick after commit -> restore -> re-measure the scroll window.
 */
export function createTwoHopAnchorRestorationController(
	params: TwoHopAnchorRestorationParams,
): TwoHopAnchorRestorationController {
	let pendingRestore: PendingScrollRestore | null = null;
	let postCommitMeasurementScheduled = false;
	let disposed = false;

	function preserveAnchor(): void {
		if (pendingRestore?.kind === "absolute-position") return;
		pendingRestore ??= captureLayoutAnchor();
	}

	function captureLayoutAnchor(): PendingLayoutAnchor | null {
		const anchor = captureTwoHopLayoutAnchor(
			params.getRootEl(),
			params.getRowModel(),
			params.getMeasurement(),
		);
		return anchor ? { kind: "layout-anchor", anchor } : null;
	}

	function preserveScrollPosition(): void {
		if (pendingRestore?.kind === "absolute-position") return;
		const position = captureTwoHopScrollPosition(
			params.getRootEl(),
			params.getMeasurement(),
		);
		pendingRestore = position ? { kind: "absolute-position", position } : null;
	}

	function discardPendingAnchor(): void {
		if (pendingRestore?.kind === "layout-anchor") pendingRestore = null;
	}

	function scheduleAfterSnapshot(): void {
		if (!pendingRestore) return;
		schedulePostCommitMeasurement();
	}

	function restoreAfterCommit(): void {
		schedulePostCommitMeasurement();
	}

	function schedulePostCommitMeasurement(): void {
		if (postCommitMeasurementScheduled) return;
		postCommitMeasurementScheduled = true;
		// The committed content height must reach the DOM before scrollTop can
		// reflect its new clamp. Coalesce intervening data and layout updates.
		void tick().then(runPostCommitMeasurement);
	}

	function runPostCommitMeasurement(): void {
		postCommitMeasurementScheduled = false;
		if (disposed) return;
		if (!params.isRowModelCommitted()) {
			params.scheduleLayoutMeasurement();
			return;
		}

		const pending = pendingRestore;
		pendingRestore = null;
		if (pending?.kind === "absolute-position") {
			const restoration = restoreTwoHopScrollPosition(
				pending.position,
				params.getRootEl(),
			);
			if (restoration && restoration.delta !== 0) {
				params.suppressNextNativeScroll(restoration.scrollTop);
			}
		} else if (pending?.kind === "layout-anchor") {
			const delta = restoreTwoHopLayoutAnchor(
				pending.anchor,
				params.getRootEl(),
				params.getRowModel(),
			);
			if (delta !== 0) {
				params.suppressNextNativeScroll(pending.anchor.scrollTop + delta);
			}
		}
		// A shorter DOM can clamp scrolling even when no anchor can be captured.
		params.runDataChangeMeasurement();
	}

	function dispose(): void {
		disposed = true;
		pendingRestore = null;
	}

	return {
		preserveAnchor,
		preserveScrollPosition,
		discardPendingAnchor,
		scheduleAfterSnapshot,
		restoreAfterCommit,
		dispose,
	};
}
