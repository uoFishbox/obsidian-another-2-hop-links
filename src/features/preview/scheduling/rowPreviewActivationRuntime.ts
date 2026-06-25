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
	readonly getVisibleQueueSize: () => number;
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
	/**
	 * Notifies the runtime that a row's visibility has changed.
	 *
	 * `"visible"` enqueues the row's candidates; `"mounted"` cancels pending
	 * requests while keeping the candidates registered.
	 */
	setRowVisibility(rowIndex: number, visibility: "visible" | "mounted"): void;
	/**
	 * Removes a row and all its candidates and pending requests.
	 */
	clearRow(rowIndex: number): void;
}

export const PREVIEW_ROW_ACTIVATION_CONTEXT_KEY = Symbol("preview-row-activation");

interface RowActivationState {
	visibility: "visible" | "mounted";
	candidates: Map<string, RowPreviewActivationCandidate>;
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

	function getOrCreateRowState(rowIndex: number): RowActivationState {
		const existing = rows.get(rowIndex);
		if (existing) {
			return existing;
		}

		const state: RowActivationState = {
			visibility: "mounted",
			candidates: new Map<string, RowPreviewActivationCandidate>(),
		};
		rows.set(rowIndex, state);
		return state;
	}

	function hasCandidateWithKey(activationKey: string): boolean {
		for (const state of rows.values()) {
			for (const candidate of state.candidates.values()) {
				if (candidate.activationKey === activationKey) {
					return true;
				}
			}
		}

		return false;
	}

	function hasVisibleCandidateWithKey(activationKey: string): boolean {
		for (const state of rows.values()) {
			if (state.visibility !== "visible") {
				continue;
			}

			for (const candidate of state.candidates.values()) {
				if (candidate.activationKey === activationKey) {
					return true;
				}
			}
		}

		return false;
	}

	function cancelPendingByKey(activationKey: string): void {
		const handle = pendingByActivationKey.get(activationKey);
		if (handle) {
			handle.cancel();
			pendingByActivationKey.delete(activationKey);
		}
	}

	function cancelPendingUnlessVisibleElsewhere(activationKey: string): void {
		if (hasVisibleCandidateWithKey(activationKey)) {
			return;
		}

		cancelPendingByKey(activationKey);
	}

	function notifyVisibleCandidates(activationKey: string): void {
		for (const state of rows.values()) {
			if (state.visibility !== "visible") {
				continue;
			}

			for (const candidate of state.candidates.values()) {
				if (candidate.activationKey !== activationKey) {
					continue;
				}

				try {
					candidate.onActivated(activationKey);
				} catch (error) {
					console.error("Row preview activation callback failed", error);
				}
			}
		}
	}

	function enqueueActivationForKey(
		activationKey: string,
		getVisibleQueueSize: () => number,
	): void {
		if (pendingByActivationKey.has(activationKey)) {
			return;
		}

		const handle = requestQueuedPreviewActivation(
			activationKey,
			getVisibleQueueSize,
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

		const queuedKeys = new Set<string>();
		for (const candidate of state.candidates.values()) {
			const { activationKey } = candidate;
			if (queuedKeys.has(activationKey)) {
				continue;
			}
			queuedKeys.add(activationKey);

			enqueueActivationForKey(activationKey, candidate.getVisibleQueueSize);
		}
	}

	function registerCandidate(candidate: RowPreviewActivationCandidate): () => void {
		const { id, rowIndex, activationKey } = candidate;
		const state = getOrCreateRowState(rowIndex);

		// Remove any previous registration with the same id so the cleanup
		// contract stays tied to the current component lifetime.
		const previousCandidate = state.candidates.get(id);
		if (previousCandidate) {
			state.candidates.delete(id);
			if (!hasCandidateWithKey(previousCandidate.activationKey)) {
				cancelPendingByKey(previousCandidate.activationKey);
			}
		}

		state.candidates.set(id, candidate);

		if (state.visibility === "visible") {
			enqueueRowCandidates(rowIndex);
		}

		return () => {
			const currentState = rows.get(rowIndex);
			if (!currentState) {
				return;
			}

			const hadCandidate = currentState.candidates.delete(id);
			if (!hadCandidate) {
				return;
			}

			if (!hasCandidateWithKey(activationKey)) {
				cancelPendingByKey(activationKey);
			}
		};
	}

	function setRowVisibility(
		rowIndex: number,
		visibility: "visible" | "mounted",
	): void {
		const state = getOrCreateRowState(rowIndex);
		state.visibility = visibility;

		if (visibility === "visible") {
			enqueueRowCandidates(rowIndex);
			return;
		}

		const queuedKeys = new Set<string>();
		for (const candidate of state.candidates.values()) {
			const { activationKey } = candidate;
			if (queuedKeys.has(activationKey)) {
				continue;
			}
			queuedKeys.add(activationKey);

			cancelPendingUnlessVisibleElsewhere(activationKey);
		}
	}

	function clearRow(rowIndex: number): void {
		const state = rows.get(rowIndex);
		if (!state) {
			return;
		}

		const activationKeys = new Set<string>();
		for (const candidate of state.candidates.values()) {
			activationKeys.add(candidate.activationKey);
		}

		rows.delete(rowIndex);

		for (const activationKey of activationKeys) {
			cancelPendingUnlessVisibleElsewhere(activationKey);
		}
	}

	return {
		registerCandidate,
		setRowVisibility,
		clearRow,
	};
}
