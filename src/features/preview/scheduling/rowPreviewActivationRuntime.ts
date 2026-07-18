import type { PreviewActivationHandle } from "./previewActivationScheduler";
import {
	createPreviewActivationScope,
	requestQueuedPreviewActivation,
} from "./previewActivationScheduler";
import type { PreviewActivationScope } from "./previewActivationScope";

export interface RowPreviewActivationCandidate {
	readonly id: string;
	readonly rowIndex: number;
	readonly activationKey: string;
	readonly onActivated: (activationKey: string) => void;
}

export interface RowPreviewActivationRuntime {
	/**
	 * Registers a preview activation candidate for a row.
	 *
	 * The returned function unregisters the candidate and cancels any pending
	 * activation request for its key when no other candidates share that key.
	 */
	registerCandidate(candidate: RowPreviewActivationCandidate): () => void;
	/** Applies a complete row visibility change as one atomic update. */
	applyVisibilityDelta(delta: RowPreviewVisibilityDelta): void;
	/**
	 * Notifies the runtime that a row's visibility has changed.
	 *
	 * `"visible"` enqueues the row's candidates; `"mounted"` cancels pending
	 * requests while keeping the candidates registered.
	 */
	setRowVisibility(rowIndex: number, visibility: "visible" | "mounted"): void;
	/**
	 * Deactivates a row and cancels its pending requests.
	 *
	 * Candidate registrations are retained until their component cleanup runs.
	 * Virtual row shells can be cleared and rebound without unmounting their
	 * card components, so dropping registrations here would leave an unchanged
	 * card with no way to register again.
	 */
	clearRow(rowIndex: number): void;
	/** Releases all row registrations and pending activation handles. */
	dispose(): void;
}

export interface RowPreviewVisibilityDelta {
	readonly activatedRows: readonly number[];
	readonly deactivatedRows: readonly number[];
	readonly clearedRows: readonly number[];
}

export const PREVIEW_ROW_ACTIVATION_CONTEXT_KEY = Symbol("preview-row-activation");

interface RowActivationState {
	visibility: "visible" | "mounted";
	candidatesById: Map<string, RowPreviewActivationCandidate>;
	keyCounts: Map<string, number>;
}

export interface CreateRowPreviewActivationRuntimeOptions {
	scope?: PreviewActivationScope;
}

export function createRowPreviewActivationRuntime(
	options: CreateRowPreviewActivationRuntimeOptions = {},
): RowPreviewActivationRuntime {
	const scope = options.scope ?? createPreviewActivationScope();
	const rows = new Map<number, RowActivationState>();
	const pendingByActivationKey = new Map<string, PreviewActivationHandle>();
	const allCandidatesByKey = new Map<string, Set<RowPreviewActivationCandidate>>();
	const visibleCandidatesByKey = new Map<
		string,
		Set<RowPreviewActivationCandidate>
	>();
	let disposed = false;

	function getOrCreateRowState(rowIndex: number): RowActivationState {
		const existing = rows.get(rowIndex);
		if (existing) {
			return existing;
		}

		const state: RowActivationState = {
			visibility: "mounted",
			candidatesById: new Map<string, RowPreviewActivationCandidate>(),
			keyCounts: new Map<string, number>(),
		};
		rows.set(rowIndex, state);
		return state;
	}

	function addCandidateToIndex(
		index: Map<string, Set<RowPreviewActivationCandidate>>,
		candidate: RowPreviewActivationCandidate,
	): void {
		const existing = index.get(candidate.activationKey);
		if (existing) {
			existing.add(candidate);
			return;
		}

		index.set(candidate.activationKey, new Set([candidate]));
	}

	function removeCandidateFromIndex(
		index: Map<string, Set<RowPreviewActivationCandidate>>,
		candidate: RowPreviewActivationCandidate,
	): void {
		const candidates = index.get(candidate.activationKey);
		if (!candidates) return;

		candidates.delete(candidate);
		if (candidates.size === 0) {
			index.delete(candidate.activationKey);
		}
	}

	function incrementRowKeyCount(
		state: RowActivationState,
		activationKey: string,
	): void {
		state.keyCounts.set(
			activationKey,
			(state.keyCounts.get(activationKey) ?? 0) + 1,
		);
	}

	function decrementRowKeyCount(
		state: RowActivationState,
		activationKey: string,
	): void {
		const nextCount = (state.keyCounts.get(activationKey) ?? 0) - 1;
		if (nextCount > 0) {
			state.keyCounts.set(activationKey, nextCount);
			return;
		}

		state.keyCounts.delete(activationKey);
	}

	function addCandidateToRow(
		state: RowActivationState,
		candidate: RowPreviewActivationCandidate,
	): void {
		state.candidatesById.set(candidate.id, candidate);
		incrementRowKeyCount(state, candidate.activationKey);
		addCandidateToIndex(allCandidatesByKey, candidate);
		if (state.visibility === "visible") {
			addCandidateToIndex(visibleCandidatesByKey, candidate);
		}
	}

	function removeCandidateFromRow(
		state: RowActivationState,
		candidate: RowPreviewActivationCandidate,
	): void {
		state.candidatesById.delete(candidate.id);
		decrementRowKeyCount(state, candidate.activationKey);
		removeCandidateFromIndex(allCandidatesByKey, candidate);
		if (state.visibility === "visible") {
			removeCandidateFromIndex(visibleCandidatesByKey, candidate);
		}
	}

	function pruneRowIfEmpty(rowIndex: number, state: RowActivationState): void {
		if (state.visibility !== "mounted") return;
		if (state.candidatesById.size > 0 || state.keyCounts.size > 0) return;
		if (rows.get(rowIndex) === state) {
			rows.delete(rowIndex);
		}
	}

	function cancelPendingByKey(activationKey: string): void {
		const handle = pendingByActivationKey.get(activationKey);
		if (handle) {
			handle.cancel();
			pendingByActivationKey.delete(activationKey);
		}
	}

	function cancelPendingUnlessVisibleElsewhere(activationKey: string): void {
		if (visibleCandidatesByKey.has(activationKey)) {
			return;
		}

		cancelPendingByKey(activationKey);
	}

	function notifyVisibleCandidates(activationKey: string): void {
		if (disposed) return;
		const candidates = visibleCandidatesByKey.get(activationKey);
		if (!candidates) return;

		for (const candidate of Array.from(candidates)) {
			try {
				candidate.onActivated(activationKey);
			} catch (error) {
				console.error("Row preview activation callback failed", error);
			}
		}
	}

	function enqueueActivationForKey(activationKey: string): void {
		if (pendingByActivationKey.has(activationKey)) {
			return;
		}

		const handle = requestQueuedPreviewActivation(
			activationKey,
			scope,
			(activated) => {
				pendingByActivationKey.delete(activationKey);
				if (!activated) {
					return;
				}

				notifyVisibleCandidates(activationKey);
			},
		);

		pendingByActivationKey.set(activationKey, handle);
	}

	function enqueueRowCandidates(rowIndex: number): void {
		const state = rows.get(rowIndex);
		if (!state || state.visibility !== "visible") {
			return;
		}

		for (const activationKey of state.keyCounts.keys()) {
			enqueueActivationForKey(activationKey);
		}
	}

	function registerCandidate(candidate: RowPreviewActivationCandidate): () => void {
		if (disposed) return () => {};

		const { id, rowIndex, activationKey } = candidate;
		const state = getOrCreateRowState(rowIndex);

		// Remove any previous registration with the same id so the cleanup
		// contract stays tied to the current component lifetime.
		const previousCandidate = state.candidatesById.get(id);
		if (previousCandidate) {
			removeCandidateFromRow(state, previousCandidate);
			if (state.visibility === "visible") {
				cancelPendingUnlessVisibleElsewhere(previousCandidate.activationKey);
			} else if (!allCandidatesByKey.has(previousCandidate.activationKey)) {
				cancelPendingByKey(previousCandidate.activationKey);
			}
		}

		addCandidateToRow(state, candidate);

		if (state.visibility === "visible") {
			enqueueRowCandidates(rowIndex);
		}

		return () => {
			const currentState = rows.get(rowIndex);
			if (!currentState) {
				return;
			}

			const currentCandidate = currentState.candidatesById.get(id);
			if (!currentCandidate) {
				return;
			}
			if (currentCandidate !== candidate) {
				return;
			}

			removeCandidateFromRow(currentState, currentCandidate);
			if (currentState.visibility === "visible") {
				cancelPendingUnlessVisibleElsewhere(activationKey);
			} else if (!allCandidatesByKey.has(activationKey)) {
				cancelPendingByKey(activationKey);
			}
			pruneRowIfEmpty(rowIndex, currentState);
		};
	}

	function setRowVisibility(
		rowIndex: number,
		visibility: "visible" | "mounted",
	): void {
		applyVisibilityDelta({
			activatedRows: visibility === "visible" ? [rowIndex] : [],
			deactivatedRows: visibility === "mounted" ? [rowIndex] : [],
			clearedRows: [],
		});
	}

	function clearRow(rowIndex: number): void {
		applyVisibilityDelta({
			activatedRows: [],
			deactivatedRows: [],
			clearedRows: [rowIndex],
		});
	}

	function applyVisibilityDelta(delta: RowPreviewVisibilityDelta): void {
		if (disposed) return;

		type FinalRowChange = "activated" | "deactivated" | "cleared";
		const finalChanges = new Map<number, FinalRowChange>();
		for (const rowIndex of delta.clearedRows) {
			finalChanges.set(rowIndex, "cleared");
		}
		for (const rowIndex of delta.deactivatedRows) {
			finalChanges.set(rowIndex, "deactivated");
		}
		for (const rowIndex of delta.activatedRows) {
			finalChanges.set(rowIndex, "activated");
		}

		const keysToCancel = new Set<string>();
		const rowsToPrune: Array<[number, RowActivationState]> = [];
		for (const [rowIndex, change] of finalChanges) {
			if (change === "activated") continue;

			const state = rows.get(rowIndex);
			if (!state) continue;
			if (state.visibility === "visible") {
				for (const candidate of state.candidatesById.values()) {
					removeCandidateFromIndex(visibleCandidatesByKey, candidate);
				}
			}

			state.visibility = "mounted";
			for (const activationKey of state.keyCounts.keys()) {
				keysToCancel.add(activationKey);
			}
			rowsToPrune.push([rowIndex, state]);
		}

		for (const [rowIndex, change] of finalChanges) {
			if (change !== "activated") continue;

			const state = getOrCreateRowState(rowIndex);
			if (state.visibility !== "visible") {
				state.visibility = "visible";
				for (const candidate of state.candidatesById.values()) {
					addCandidateToIndex(visibleCandidatesByKey, candidate);
				}
			}
		}

		for (const activationKey of keysToCancel) {
			cancelPendingUnlessVisibleElsewhere(activationKey);
		}
		for (const [rowIndex, change] of finalChanges) {
			if (change === "activated") {
				enqueueRowCandidates(rowIndex);
			}
		}
		for (const [rowIndex, state] of rowsToPrune) {
			pruneRowIfEmpty(rowIndex, state);
		}
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;

		for (const handle of pendingByActivationKey.values()) {
			handle.cancel();
		}
		pendingByActivationKey.clear();
		rows.clear();
		allCandidatesByKey.clear();
		visibleCandidatesByKey.clear();
	}

	return {
		registerCandidate,
		applyVisibilityDelta,
		setRowVisibility,
		clearRow,
		dispose,
	};
}
