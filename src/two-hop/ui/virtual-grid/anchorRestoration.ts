import { tick } from "svelte";
import { resolveVisibleRange } from "cards/virtualization/public";
import { getOptionalOwnerWindow } from "shared/ui/dom/realmSafeDom";
import { findNearestScrollContainer } from "shared/ui/scroll/scrollContainer";
import type { TwoHopRowModel } from "./rowModel";

export interface TwoHopLayoutAnchor {
	readonly logicalKey: string;
	readonly rowTop: number;
	readonly scrollTop: number;
	readonly scrollRoot: HTMLElement | null;
}

export interface TwoHopLayoutAnchorMeasurement {
	readonly viewportHeight: number;
	readonly sectionTop: number;
	readonly scrollContainerEl: HTMLElement | null;
}

export interface TwoHopScrollPosition {
	readonly scrollTop: number;
	readonly scrollRoot: HTMLElement | null;
}

/** Captures the parent scroll offset without tying it to a particular card. */
export function captureTwoHopScrollPosition(
	rootEl: HTMLElement | null,
	measurement: TwoHopLayoutAnchorMeasurement,
): TwoHopScrollPosition | null {
	if (!rootEl) return null;
	const ownerWindow = getOptionalOwnerWindow(rootEl);
	if (!ownerWindow) return null;
	const scrollRoot =
		measurement.scrollContainerEl ?? findNearestScrollContainer(rootEl);
	return {
		scrollTop: scrollRoot?.scrollTop ?? ownerWindow.scrollY,
		scrollRoot,
	};
}

/** Restores an absolute parent scroll offset after result-set DOM replacement. */
export function restoreTwoHopScrollPosition(
	position: TwoHopScrollPosition | null,
	rootEl: HTMLElement | null,
): { readonly delta: number; readonly scrollTop: number } | null {
	if (!position || !rootEl) return null;
	const ownerWindow = getOptionalOwnerWindow(rootEl);
	if (!ownerWindow) return null;
	const currentScrollRoot = findNearestScrollContainer(rootEl);
	if (currentScrollRoot !== position.scrollRoot) return null;

	const currentScrollTop = currentScrollRoot?.scrollTop ?? ownerWindow.scrollY;
	if (Math.abs(currentScrollTop - position.scrollTop) >= 0.5) {
		if (currentScrollRoot) currentScrollRoot.scrollTop = position.scrollTop;
		else ownerWindow.scrollBy({ top: position.scrollTop - currentScrollTop });
	}
	const restoredScrollTop = currentScrollRoot?.scrollTop ?? ownerWindow.scrollY;
	return {
		delta: restoredScrollTop - currentScrollTop,
		scrollTop: restoredScrollTop,
	};
}

/** Captures the first visible cell so layout changes can preserve its position. */
export function captureTwoHopLayoutAnchor(
	rootEl: HTMLElement | null,
	rowModel: TwoHopRowModel,
	measurement: TwoHopLayoutAnchorMeasurement,
): TwoHopLayoutAnchor | null {
	if (!rootEl || measurement.viewportHeight <= 0) return null;

	const ownerWindow = getOptionalOwnerWindow(rootEl);
	if (!ownerWindow) return null;
	const scrollRoot = measurement.scrollContainerEl;
	const scrollTop = scrollRoot?.scrollTop ?? ownerWindow.scrollY;
	const visible = resolveVisibleRange(rowModel, {
		scrollTop: scrollTop - measurement.sectionTop,
		viewportHeight: measurement.viewportHeight,
		overscanPx: 0,
	});
	if (visible.start >= visible.end) return null;

	const row = rowModel.getRow(visible.start);
	const cell = row?.getCell(0);
	if (!row || !cell) return null;
	return {
		logicalKey: cell.logicalKey,
		rowTop: row.top,
		scrollTop,
		scrollRoot,
	};
}

/** Restores a captured cell only if the user and scroll-root state stayed put. */
export function restoreTwoHopLayoutAnchor(
	anchor: TwoHopLayoutAnchor | null,
	rootEl: HTMLElement | null,
	nextRowModel: TwoHopRowModel,
): number {
	if (!anchor || !rootEl) return 0;

	const ownerWindow = getOptionalOwnerWindow(rootEl);
	if (!ownerWindow) return 0;
	const currentScrollRoot = findNearestScrollContainer(rootEl);
	if (currentScrollRoot !== anchor.scrollRoot) return 0;
	const currentScrollTop = currentScrollRoot?.scrollTop ?? ownerWindow.scrollY;
	if (Math.abs(currentScrollTop - anchor.scrollTop) >= 0.5) return 0;

	const position = nextRowModel.resolveCellPosition(anchor.logicalKey);
	const nextRow = position ? nextRowModel.getRow(position.rowIndex) : null;
	if (!nextRow) return 0;
	const delta = nextRow.top - anchor.rowTop;
	if (Math.abs(delta) < 0.5) return 0;

	if (currentScrollRoot) currentScrollRoot.scrollTop += delta;
	else ownerWindow.scrollBy({ top: delta });
	return (currentScrollRoot?.scrollTop ?? ownerWindow.scrollY) - currentScrollTop;
}

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

/**
 * Owns the post-layout scroll restoration state machine:
 * capture -> tick after commit -> restore -> re-measure the scroll window.
 */
export function createTwoHopAnchorRestorationController(
	params: TwoHopAnchorRestorationParams,
) {
	let pendingRestore: PendingScrollRestore | null = null;
	let postCommitMeasurementScheduled = false;
	let disposed = false;

	function preserveAnchor(): void {
		if (pendingRestore) return;
		const anchor = captureTwoHopLayoutAnchor(
			params.getRootEl(),
			params.getRowModel(),
			params.getMeasurement(),
		);
		if (anchor) pendingRestore = { kind: "layout-anchor", anchor };
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
