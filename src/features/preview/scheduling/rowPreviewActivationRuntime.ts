import { writable, type Readable, type Writable } from "svelte/store";
import type { PreviewActivationHandle } from "./previewActivationScheduler";
import {
	createPreviewActivationScope,
	requestQueuedPreviewActivation,
} from "./previewActivationScheduler";
import type { PreviewActivationScope } from "./previewActivationScope";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { IS_PROD } from "appConstants";

export interface RowPreviewActivationRuntime {
	/**
	 * Returns an activation version store for a caller-defined key. The value
	 * increments when that key may mount card previews.
	 */
	getActivationVersion(key: string): Readable<number>;
	/**
	 * Requests one queued activation for a visible key. Multiple requests for
	 * the same key share one pending scheduler entry.
	 */
	requestActivation(key: string): void;
	/**
	 * Notifies the runtime that an activation key's visibility has changed.
	 *
	 * `"visible"` enqueues one activation request for the key. `"mounted"`
	 * cancels the pending request while keeping the activation store alive.
	 */
	setVisibility(key: string, visibility: "visible" | "mounted"): void;
	/**
	 * Removes an activation store and any pending request.
	 */
	clear(key: string): void;
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

type ActivationRequestSource = "setVisibility" | "requestActivation";

export interface CreateRowPreviewActivationRuntimeOptions {
	scope?: PreviewActivationScope;
	getVisibleQueueSize?: () => number;
}

let nextRowPreviewActivationRuntimeId = 0;

const getRowActivationKey = (rowIndex: number): string => `row:${rowIndex}`;

export function createRowPreviewActivationRuntime(
	options: CreateRowPreviewActivationRuntimeOptions = {},
): RowPreviewActivationRuntime {
	const scope = options.scope ?? createPreviewActivationScope();
	const getVisibleQueueSize = options.getVisibleQueueSize ?? (() => 0);
	const runtimeId = ++nextRowPreviewActivationRuntimeId;
	const entries = new Map<string, RowActivationState>();
	const pendingByKey = new Map<string, PreviewActivationHandle>();

	function getOrCreateState(key: string): RowActivationState {
		const existing = entries.get(key);
		if (existing) {
			return existing;
		}

		const state: RowActivationState = {
			visibility: "mounted",
			requestKey: buildActivationRequestKey(key),
			activationVersion: 0,
			activationVersionStore: writable(0),
		};
		entries.set(key, state);
		return state;
	}

	function buildActivationRequestKey(key: string): string {
		return `row-preview:${runtimeId}:${key}`;
	}

	function cancelPending(key: string): void {
		const handle = pendingByKey.get(key);
		if (!handle) {
			return;
		}

		handle.cancel();
		pendingByKey.delete(key);
	}

	function notifyVisibleActivation(key: string): void {
		const state = entries.get(key);
		if (!state || state.visibility !== "visible") {
			return;
		}

		if (!IS_PROD) {
			recordCCLDevMeasurement(
				"RowPreviewActivationRuntime.notifyVisibleActivation",
			);
		}
		state.activationVersion += 1;
		state.activationVersionStore.set(state.activationVersion);
	}

	function recordAcceptedEnqueueSource(source: ActivationRequestSource): void {
		recordCCLDevMeasurement(
			source === "setVisibility"
				? "RowPreviewActivationRuntime.enqueueActivation.fromSetVisibility"
				: "RowPreviewActivationRuntime.enqueueActivation.fromRequestActivation",
		);
	}

	function recordDedupedEnqueueSource(source: ActivationRequestSource): void {
		recordCCLDevMeasurement(
			source === "setVisibility"
				? "RowPreviewActivationRuntime.enqueueActivation.dedupedPending.fromSetVisibility"
				: "RowPreviewActivationRuntime.enqueueActivation.dedupedPending.fromRequestActivation",
		);
	}

	function enqueueActivation(key: string, source: ActivationRequestSource): void {
		if (pendingByKey.has(key)) {
			if (!IS_PROD) {
				recordCCLDevMeasurement(
					"RowPreviewActivationRuntime.enqueueActivation.dedupedPending",
				);
				recordDedupedEnqueueSource(source);
			}
			return;
		}

		const state = entries.get(key);
		if (!state || state.visibility !== "visible") {
			if (!IS_PROD) {
				recordCCLDevMeasurement(
					"RowPreviewActivationRuntime.enqueueActivation.skipNotVisible",
				);
			}
			return;
		}

		if (!IS_PROD) {
			recordCCLDevMeasurement("RowPreviewActivationRuntime.enqueueActivation");
			recordAcceptedEnqueueSource(source);
		}
		let request: PreviewActivationHandle | null = null;
		let synchronousResult: boolean | undefined;
		const onSettled = (activated: boolean): void => {
			if (!request) {
				synchronousResult = activated;
				return;
			}

			if (pendingByKey.get(key) !== request) {
				return;
			}

			pendingByKey.delete(key);
			if (!activated) {
				return;
			}

			notifyVisibleActivation(key);
		};

		request = requestQueuedPreviewActivation(
			state.requestKey,
			getVisibleQueueSize,
			scope,
			onSettled,
		);
		pendingByKey.set(key, request);

		if (synchronousResult !== undefined) {
			onSettled(synchronousResult);
		}
	}

	function getActivationVersion(key: string): Readable<number> {
		return getOrCreateState(key).activationVersionStore;
	}

	function requestActivation(key: string): void {
		if (!IS_PROD) {
			recordCCLDevMeasurement("RowPreviewActivationRuntime.requestActivation");
		}
		const state = entries.get(key);
		if (!state || state.visibility !== "visible") {
			if (!IS_PROD) {
				recordCCLDevMeasurement(
					"RowPreviewActivationRuntime.requestActivation.skipNotVisible",
				);
			}
			return;
		}

		enqueueActivation(key, "requestActivation");
	}

	function setVisibility(key: string, visibility: "visible" | "mounted"): void {
		const state =
			visibility === "visible" ? getOrCreateState(key) : entries.get(key);
		if (!state) {
			return;
		}

		const previousVisibility = state.visibility;
		state.visibility = visibility;

		if (visibility === "visible") {
			if (!IS_PROD) {
				recordCCLDevMeasurement(
					"RowPreviewActivationRuntime.setVisibility.visible",
				);
				if (previousVisibility === "visible") {
					recordCCLDevMeasurement(
						"RowPreviewActivationRuntime.setVisibility.visibleUnchanged",
					);
				}
			}
			enqueueActivation(key, "setVisibility");
			return;
		}

		if (!IS_PROD) {
			recordCCLDevMeasurement(
				"RowPreviewActivationRuntime.setVisibility.mounted",
			);
			if (previousVisibility === "mounted") {
				recordCCLDevMeasurement(
					"RowPreviewActivationRuntime.setVisibility.mountedUnchanged",
				);
			}
		}
		cancelPending(key);
	}

	function clear(key: string): void {
		if (!entries.has(key)) {
			return;
		}

		entries.delete(key);
		cancelPending(key);
	}

	function getRowActivationVersion(rowIndex: number): Readable<number> {
		return getActivationVersion(getRowActivationKey(rowIndex));
	}

	function requestRowActivation(rowIndex: number): void {
		requestActivation(getRowActivationKey(rowIndex));
	}

	function setRowVisibility(
		rowIndex: number,
		visibility: "visible" | "mounted",
	): void {
		setVisibility(getRowActivationKey(rowIndex), visibility);
	}

	function clearRow(rowIndex: number): void {
		clear(getRowActivationKey(rowIndex));
	}

	return {
		getActivationVersion,
		requestActivation,
		setVisibility,
		clear,
		getRowActivationVersion,
		requestRowActivation,
		setRowVisibility,
		clearRow,
	};
}
