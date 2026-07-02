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
	 * The returned function unregisters the candidate. Pending activation is
	 * managed per row: as long as the visible row still has at least one
	 * candidate, one queued activation request covers the whole row.
	 */
	registerCandidate(candidate: RowPreviewActivationCandidate): () => void;
	/**
	 * Notifies the runtime that a row's visibility has changed.
	 *
	 * `"visible"` enqueues one activation request for the row. `"mounted"`
	 * cancels the pending row request while keeping candidates registered.
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

let nextRowPreviewActivationRuntimeId = 0;

export function createRowPreviewActivationRuntime(
	options: CreateRowPreviewActivationRuntimeOptions = {},
): RowPreviewActivationRuntime {
	const scope = options.scope ?? createPreviewActivationScope();
	const runtimeId = ++nextRowPreviewActivationRuntimeId;
	const rows = new Map<number, RowActivationState>();
	const pendingByRowIndex = new Map<number, PreviewActivationHandle>();

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

	function buildRowActivationRequestKey(rowIndex: number): string {
		return `row-preview:${runtimeId}:${rowIndex}`;
	}

	function cancelPendingRow(rowIndex: number): void {
		const handle = pendingByRowIndex.get(rowIndex);
		if (!handle) {
			return;
		}

		handle.cancel();
		pendingByRowIndex.delete(rowIndex);
	}

	function notifyVisibleRowCandidates(rowIndex: number): void {
		const state = rows.get(rowIndex);
		if (!state || state.visibility !== "visible") {
			return;
		}

		for (const candidate of state.candidates.values()) {
			try {
				candidate.onActivated(candidate.activationKey);
			} catch (error) {
				console.error("Row preview activation callback failed", error);
			}
		}
	}

	function enqueueRowActivation(rowIndex: number): void {
		if (pendingByRowIndex.has(rowIndex)) {
			return;
		}

		const state = rows.get(rowIndex);
		if (!state || state.visibility !== "visible") {
			return;
		}

		const firstCandidate = state.candidates.values().next().value;
		if (!firstCandidate) {
			return;
		}

		let request: PreviewActivationHandle | null = null;
		let synchronousResult: boolean | undefined;
		const requestKey = buildRowActivationRequestKey(rowIndex);
		const onSettled = (activated: boolean): void => {
			if (!request) {
				synchronousResult = activated;
				return;
			}

			if (pendingByRowIndex.get(rowIndex) !== request) {
				return;
			}

			pendingByRowIndex.delete(rowIndex);
			if (!activated) {
				return;
			}

			notifyVisibleRowCandidates(rowIndex);
		};

		request = requestQueuedPreviewActivation(
			requestKey,
			firstCandidate.getVisibleQueueSize,
			scope,
			onSettled,
		);
		pendingByRowIndex.set(rowIndex, request);

		if (synchronousResult !== undefined) {
			onSettled(synchronousResult);
		}
	}

	function registerCandidate(candidate: RowPreviewActivationCandidate): () => void {
		const { id, rowIndex } = candidate;
		const state = getOrCreateRowState(rowIndex);

		// Remove any previous registration with the same id so the cleanup
		// contract stays tied to the current component lifetime.
		state.candidates.delete(id);
		state.candidates.set(id, candidate);

		if (state.visibility === "visible") {
			enqueueRowActivation(rowIndex);
		}

		return () => {
			const currentState = rows.get(rowIndex);
			if (!currentState) {
				return;
			}

			if (currentState.candidates.get(id) !== candidate) {
				return;
			}

			currentState.candidates.delete(id);
			if (currentState.candidates.size === 0) {
				cancelPendingRow(rowIndex);
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
			enqueueRowActivation(rowIndex);
			return;
		}

		cancelPendingRow(rowIndex);
	}

	function clearRow(rowIndex: number): void {
		if (!rows.has(rowIndex)) {
			return;
		}

		rows.delete(rowIndex);
		cancelPendingRow(rowIndex);
	}

	return {
		registerCandidate,
		setRowVisibility,
		clearRow,
	};
}
