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
	pendingByActivationKey: Map<string, PreviewActivationHandle>;
}

export interface CreateRowPreviewActivationRuntimeOptions {
	scope?: PreviewActivationScope;
}

export function createRowPreviewActivationRuntime(
	options: CreateRowPreviewActivationRuntimeOptions = {},
): RowPreviewActivationRuntime {
	const scope = options.scope ?? createPreviewActivationScope();
	const rows = new Map<number, RowActivationState>();

	function getOrCreateRowState(rowIndex: number): RowActivationState {
		const existing = rows.get(rowIndex);
		if (existing) {
			return existing;
		}

		const state: RowActivationState = {
			visibility: "mounted",
			candidates: new Map<string, RowPreviewActivationCandidate>(),
			pendingByActivationKey: new Map<string, PreviewActivationHandle>(),
		};
		rows.set(rowIndex, state);
		return state;
	}

	function hasCandidateWithKey(
		state: RowActivationState,
		activationKey: string,
	): boolean {
		for (const candidate of state.candidates.values()) {
			if (candidate.activationKey === activationKey) {
				return true;
			}
		}

		return false;
	}

	function cancelPendingByKey(
		state: RowActivationState,
		activationKey: string,
	): void {
		const handle = state.pendingByActivationKey.get(activationKey);
		if (handle) {
			handle.cancel();
			state.pendingByActivationKey.delete(activationKey);
		}
	}

	function cancelAllPending(state: RowActivationState): void {
		for (const handle of state.pendingByActivationKey.values()) {
			handle.cancel();
		}
		state.pendingByActivationKey.clear();
	}

	function enqueueActivationForKey(
		state: RowActivationState,
		activationKey: string,
		getVisibleQueueSize: () => number,
	): void {
		if (state.pendingByActivationKey.has(activationKey)) {
			return;
		}

		const handle = requestQueuedPreviewActivation(
			activationKey,
			getVisibleQueueSize,
			scope,
			(activated) => {
				state.pendingByActivationKey.delete(activationKey);
				if (!activated) {
					return;
				}

				for (const candidate of state.candidates.values()) {
					if (candidate.activationKey === activationKey) {
						try {
							candidate.onActivated(activationKey);
						} catch (error) {
							console.error(
								"Row preview activation callback failed",
								error,
							);
						}
					}
				}
			},
		);

		state.pendingByActivationKey.set(activationKey, handle);
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

			enqueueActivationForKey(
				state,
				activationKey,
				candidate.getVisibleQueueSize,
			);
		}
	}

	function registerCandidate(
		candidate: RowPreviewActivationCandidate,
	): () => void {
		const { id, rowIndex, activationKey } = candidate;
		const state = getOrCreateRowState(rowIndex);

		// Remove any previous registration with the same id so the cleanup
		// contract stays tied to the current component lifetime.
		if (state.candidates.has(id)) {
			state.candidates.delete(id);
			if (!hasCandidateWithKey(state, activationKey)) {
				cancelPendingByKey(state, activationKey);
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

			if (!hasCandidateWithKey(currentState, activationKey)) {
				cancelPendingByKey(currentState, activationKey);
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
		} else {
			cancelAllPending(state);
		}
	}

	function clearRow(rowIndex: number): void {
		const state = rows.get(rowIndex);
		if (!state) {
			return;
		}

		cancelAllPending(state);
		rows.delete(rowIndex);
	}

	return {
		registerCandidate,
		setRowVisibility,
		clearRow,
	};
}
