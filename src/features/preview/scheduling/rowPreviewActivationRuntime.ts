import { writable, type Readable, type Writable } from "svelte/store";
import type { PreviewActivationHandle } from "./previewActivationScheduler";
import {
	createPreviewActivationScope,
	requestQueuedPreviewActivation,
} from "./previewActivationScheduler";
import type { PreviewActivationScope } from "./previewActivationScope";

export interface RowPreviewActivationRuntime {
	/**
	 * Returns a row-scoped activation version store. The value increments when
	 * the row may mount card previews.
	 */
	getRowActivationVersion(rowIndex: number): Readable<number>;
	/**
	 * Requests one queued activation for a visible row. Multiple requests for
	 * the same row share one pending scheduler entry.
	 */
	requestRowActivation(rowIndex: number): void;
	/**
	 * Notifies the runtime that a row's visibility has changed.
	 *
	 * `"visible"` enqueues one activation request for the row. `"mounted"`
	 * cancels the pending row request while keeping the activation store alive.
	 */
	setRowVisibility(rowIndex: number, visibility: "visible" | "mounted"): void;
	/**
	 * Removes a row activation store and any pending request.
	 */
	clearRow(rowIndex: number): void;
}

export const PREVIEW_ROW_ACTIVATION_CONTEXT_KEY = Symbol("preview-row-activation");

interface RowActivationState {
	visibility: "visible" | "mounted";
	readonly requestKey: string;
	activationVersion: number;
	readonly activationVersionStore: Writable<number>;
}

export interface CreateRowPreviewActivationRuntimeOptions {
	scope?: PreviewActivationScope;
	getVisibleQueueSize?: () => number;
}

let nextRowPreviewActivationRuntimeId = 0;

export function createRowPreviewActivationRuntime(
	options: CreateRowPreviewActivationRuntimeOptions = {},
): RowPreviewActivationRuntime {
	const scope = options.scope ?? createPreviewActivationScope();
	const getVisibleQueueSize = options.getVisibleQueueSize ?? (() => 0);
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
			requestKey: buildRowActivationRequestKey(rowIndex),
			activationVersion: 0,
			activationVersionStore: writable(0),
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

	function notifyVisibleRowActivation(rowIndex: number): void {
		const state = rows.get(rowIndex);
		if (!state || state.visibility !== "visible") {
			return;
		}

		state.activationVersion += 1;
		state.activationVersionStore.set(state.activationVersion);
	}

	function enqueueRowActivation(rowIndex: number): void {
		if (pendingByRowIndex.has(rowIndex)) {
			return;
		}

		const state = rows.get(rowIndex);
		if (!state || state.visibility !== "visible") {
			return;
		}

		let request: PreviewActivationHandle | null = null;
		let synchronousResult: boolean | undefined;
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

			notifyVisibleRowActivation(rowIndex);
		};

		request = requestQueuedPreviewActivation(
			state.requestKey,
			getVisibleQueueSize,
			scope,
			onSettled,
		);
		pendingByRowIndex.set(rowIndex, request);

		if (synchronousResult !== undefined) {
			onSettled(synchronousResult);
		}
	}

	function getRowActivationVersion(rowIndex: number): Readable<number> {
		return getOrCreateRowState(rowIndex).activationVersionStore;
	}

	function requestRowActivation(rowIndex: number): void {
		const state = rows.get(rowIndex);
		if (!state || state.visibility !== "visible") {
			return;
		}

		enqueueRowActivation(rowIndex);
	}

	function setRowVisibility(
		rowIndex: number,
		visibility: "visible" | "mounted",
	): void {
		const state =
			visibility === "visible"
				? getOrCreateRowState(rowIndex)
				: rows.get(rowIndex);
		if (!state) {
			return;
		}

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
		getRowActivationVersion,
		requestRowActivation,
		setRowVisibility,
		clearRow,
	};
}
