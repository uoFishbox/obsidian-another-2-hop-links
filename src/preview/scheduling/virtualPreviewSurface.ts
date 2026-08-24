import {
	type PreviewActivationHandle,
	type PreviewActivationScheduler,
	type PreviewActivationScope,
} from "./previewActivationScheduler";
import { createPreviewFrameDriver } from "./previewFrameDriver";
import type { CardPreviewRenderer } from "preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import {
	createPreviewSlotController,
	type PreviewSlotController,
} from "preview/ui/previewSlotController";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";

export interface PreviewHostLease {
	dispose(): void;
}

/** One logical card preview currently managed by the virtual surface. */
export interface VirtualPreviewBinding {
	readonly key: string;
	readonly rowIndex: number;
	readonly request: CardPreviewRequest;
}

export interface VirtualPreviewSurface {
	registerHost(key: string, element: HTMLElement): PreviewHostLease;
	/**
	 * Publishes the complete logical-card binding set for the currently managed
	 * virtual window. Callers should pass mounted/overscan cards, not the full
	 * result set.
	 */
	syncBindings(bindings: readonly VirtualPreviewBinding[]): void;
	/** Updates the active preview row range without rebuilding bindings. */
	setActiveRange(start: number, end: number, active: boolean): void;
	dispose(): void;
}

export interface CreateVirtualPreviewSurfaceOptions {
	readonly frameCoordinator?: VirtualFrameCoordinator;
	/** Realm used by the flush driver when no coordinator accepts the task. */
	readonly getWindow?: () => Window | null;
	readonly activationScheduler: PreviewActivationScheduler;
	readonly createRenderer: () => CardPreviewRenderer;
	/** Optional lifecycle probe invoked after an unbound preview entry is released. */
	readonly onEntryDisposed?: (key: string) => void;
}

interface PreviewHostRegistration {
	readonly element: HTMLElement;
	controllerLease?: PreviewHostLease;
}

interface PreviewEntryRuntime {
	readonly key: string;
	readonly controller: PreviewSlotController;
	request?: CardPreviewRequest;
	rowIndex?: number;
	desiredRequest?: CardPreviewRequest;
	desiredRowIndex?: number;
	dirty: boolean;
}

const PREVIEW_SURFACE_FLUSH_KEY = "virtual-preview-surface:flush";
const DISABLED_PREVIEW_HOST_LEASE: PreviewHostLease = { dispose: () => {} };

/**
 * Reconciles logical card previews with virtualized hosts.
 *
 * Preview identity is the logical card key, not a physical render slot. Moving a
 * card because another row/cell disappeared therefore updates only its host and
 * row position; an unchanged renderKey never restarts rendering.
 */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const entriesByKey = new Map<string, PreviewEntryRuntime>();
	const keysByRow = new Map<number, Set<string>>();
	const hostsByKey = new Map<string, Set<PreviewHostRegistration>>();
	const dirtyEntries = new Set<PreviewEntryRuntime>();
	const pendingByKey = new Map<string, PreviewActivationHandle>();
	const activationScheduler = options.activationScheduler;
	const scope: PreviewActivationScope = activationScheduler.createScope({
		frameCoordinator: options.frameCoordinator,
	});
	let desiredRangeStart = 0;
	let desiredRangeEnd = 0;
	let desiredRangeActive = false;
	let appliedRangeStart = 0;
	let appliedRangeEnd = 0;
	let appliedRangeActive = false;
	let disposed = false;
	const frameFlushDriver = createPreviewFrameDriver({
		coordinator: options.frameCoordinator,
		taskKey: PREVIEW_SURFACE_FLUSH_KEY,
		getWindow: options.getWindow,
		onFrame: applyDesiredState,
	});

	function getOrCreateEntry(key: string): PreviewEntryRuntime {
		const existing = entriesByKey.get(key);
		if (existing) return existing;
		const entry: PreviewEntryRuntime = {
			key,
			controller: createPreviewSlotController(options.createRenderer),
			dirty: false,
		};
		entriesByKey.set(key, entry);
		for (const registration of hostsByKey.get(key) ?? []) {
			registration.controllerLease = entry.controller.attachHost(
				registration.element,
			);
		}
		return entry;
	}

	function markDirty(entry: PreviewEntryRuntime): void {
		if (entry.dirty) return;
		entry.dirty = true;
		dirtyEntries.add(entry);
	}

	function scheduleFlush(): void {
		frameFlushDriver.schedule({ lane: "post-paint" });
	}

	function maybeDisposeEntry(entry: PreviewEntryRuntime): void {
		if (entry.request || entry.desiredRequest) return;
		if (entry.dirty) return;
		if (pendingByKey.has(entry.key)) return;
		removeKeyFromRow(entry.key, entry.rowIndex);
		for (const registration of hostsByKey.get(entry.key) ?? []) {
			registration.controllerLease?.dispose();
			registration.controllerLease = undefined;
		}
		entry.controller.dispose();
		entriesByKey.delete(entry.key);
		options.onEntryDisposed?.(entry.key);
	}

	function isInAppliedRange(entry: PreviewEntryRuntime): boolean {
		return (
			appliedRangeActive &&
			entry.rowIndex !== undefined &&
			entry.rowIndex >= appliedRangeStart &&
			entry.rowIndex < appliedRangeEnd
		);
	}

	function activateQueuedEntry(key: string): void {
		if (disposed) return;
		pendingByKey.delete(key);
		entriesByKey.get(key)?.controller.activate();
	}

	function enqueueActivation(key: string): void {
		if (pendingByKey.has(key)) return;
		const handle = activationScheduler.request(key, scope, () => {
			activateQueuedEntry(key);
		});
		pendingByKey.set(key, handle);
	}

	function cancelPendingActivation(key: string): void {
		const handle = pendingByKey.get(key);
		if (!handle) return;
		handle.cancel();
		pendingByKey.delete(key);
	}

	function reconcileEntry(entry: PreviewEntryRuntime): void {
		const isActive = Boolean(entry.request && isInAppliedRange(entry));
		entry.controller.setActive(isActive);
		if (isActive && entry.controller.needsActivation()) {
			enqueueActivation(entry.key);
			return;
		}
		cancelPendingActivation(entry.key);
	}

	function addKeyToRow(key: string, rowIndex: number | undefined): void {
		if (rowIndex === undefined) return;
		let keys = keysByRow.get(rowIndex);
		if (!keys) {
			keys = new Set();
			keysByRow.set(rowIndex, keys);
		}
		keys.add(key);
	}

	function removeKeyFromRow(key: string, rowIndex: number | undefined): void {
		if (rowIndex === undefined) return;
		const keys = keysByRow.get(rowIndex);
		if (!keys) return;
		keys.delete(key);
		if (keys.size === 0) keysByRow.delete(rowIndex);
	}

	function applyDirtyBinding(entry: PreviewEntryRuntime): void {
		const previousRowIndex = entry.rowIndex;
		if (entry.desiredRequest) {
			entry.controller.bind(entry.desiredRequest);
			entry.request = entry.desiredRequest;
			entry.rowIndex = entry.desiredRowIndex;
		} else {
			entry.controller.clear();
			entry.request = undefined;
			entry.rowIndex = undefined;
		}
		if (previousRowIndex !== entry.rowIndex) {
			removeKeyFromRow(entry.key, previousRowIndex);
			addKeyToRow(entry.key, entry.rowIndex);
		}
		entry.dirty = false;
	}

	function reconcileRow(rowIndex: number): void {
		for (const key of keysByRow.get(rowIndex) ?? []) {
			const entry = entriesByKey.get(key);
			if (entry) reconcileEntry(entry);
		}
	}

	function reconcileRangeDifference(
		leftStart: number,
		leftEnd: number,
		rightStart: number,
		rightEnd: number,
	): void {
		for (let rowIndex = leftStart; rowIndex < leftEnd; rowIndex += 1) {
			if (rowIndex >= rightStart && rowIndex < rightEnd) continue;
			reconcileRow(rowIndex);
		}
	}

	function applyDesiredState(): void {
		if (disposed) return;
		const previousRangeActive = appliedRangeActive;
		const previousRangeStart = appliedRangeStart;
		const previousRangeEnd = appliedRangeEnd;
		const rangeChanged =
			desiredRangeActive !== previousRangeActive ||
			desiredRangeStart !== previousRangeStart ||
			desiredRangeEnd !== previousRangeEnd;
		const dirtySnapshot = [...dirtyEntries];

		appliedRangeActive = desiredRangeActive;
		appliedRangeStart = desiredRangeStart;
		appliedRangeEnd = desiredRangeEnd;

		for (const entry of dirtySnapshot) applyDirtyBinding(entry);

		if (rangeChanged) {
			const oldStart = previousRangeActive ? previousRangeStart : 0;
			const oldEnd = previousRangeActive ? previousRangeEnd : 0;
			const nextStart = desiredRangeActive ? desiredRangeStart : 0;
			const nextEnd = desiredRangeActive ? desiredRangeEnd : 0;
			reconcileRangeDifference(oldStart, oldEnd, nextStart, nextEnd);
			reconcileRangeDifference(nextStart, nextEnd, oldStart, oldEnd);
		}
		for (const entry of dirtySnapshot) reconcileEntry(entry);
		for (const entry of dirtySnapshot) maybeDisposeEntry(entry);
		dirtyEntries.clear();
	}

	function registerHost(key: string, element: HTMLElement): PreviewHostLease {
		if (disposed) return DISABLED_PREVIEW_HOST_LEASE;
		const registration: PreviewHostRegistration = { element };
		let registrations = hostsByKey.get(key);
		if (!registrations) {
			registrations = new Set();
			hostsByKey.set(key, registrations);
		}
		registrations.add(registration);
		const entry = entriesByKey.get(key);
		if (entry) {
			registration.controllerLease = entry.controller.attachHost(element);
			reconcileEntry(entry);
		}
		let disposedLease = false;
		return {
			dispose(): void {
				if (disposedLease) return;
				disposedLease = true;
				registration.controllerLease?.dispose();
				registration.controllerLease = undefined;
				registrations?.delete(registration);
				if (registrations?.size === 0) hostsByKey.delete(key);
				const activeEntry = entriesByKey.get(key);
				if (!activeEntry) return;
				reconcileEntry(activeEntry);
				maybeDisposeEntry(activeEntry);
			},
		};
	}

	function syncBindings(bindings: readonly VirtualPreviewBinding[]): void {
		if (disposed) return;
		const seenKeys = new Set<string>();
		for (const binding of bindings) {
			seenKeys.add(binding.key);
			const entry = getOrCreateEntry(binding.key);
			const renderChanged =
				entry.desiredRequest?.renderKey !== binding.request.renderKey;
			const rowChanged = entry.desiredRowIndex !== binding.rowIndex;
			entry.desiredRequest = binding.request;
			entry.desiredRowIndex = binding.rowIndex;
			if (renderChanged || rowChanged) markDirty(entry);
		}

		for (const entry of entriesByKey.values()) {
			if (seenKeys.has(entry.key) || !entry.desiredRequest) continue;
			entry.desiredRequest = undefined;
			entry.desiredRowIndex = undefined;
			markDirty(entry);
		}
		if (dirtyEntries.size > 0) scheduleFlush();
	}

	function setActiveRange(start: number, end: number, active: boolean): void {
		if (disposed) return;
		const nextStart = active ? start : 0;
		const nextEnd = active ? end : 0;
		if (
			desiredRangeActive === active &&
			desiredRangeStart === nextStart &&
			desiredRangeEnd === nextEnd
		) {
			return;
		}
		desiredRangeActive = active;
		desiredRangeStart = nextStart;
		desiredRangeEnd = nextEnd;
		scheduleFlush();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		frameFlushDriver.dispose();
		for (const handle of pendingByKey.values()) handle.cancel();
		pendingByKey.clear();
		dirtyEntries.clear();
		for (const registrations of hostsByKey.values()) {
			for (const registration of registrations) {
				registration.controllerLease?.dispose();
			}
		}
		hostsByKey.clear();
		for (const entry of entriesByKey.values()) entry.controller.dispose();
		entriesByKey.clear();
		keysByRow.clear();
		activationScheduler.disposeScope(scope);
	}

	return {
		registerHost,
		syncBindings,
		setActiveRange,
		dispose,
	};
}
