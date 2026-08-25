import {
	type PreviewActivationHandle,
	type PreviewActivationScheduler,
	type PreviewActivationScope,
} from "./previewActivationScheduler";
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

export interface VirtualPreviewRange {
	readonly start: number;
	readonly end: number;
}

/** Complete preview state for the currently mounted/overscan virtual window. */
export interface VirtualPreviewSurfaceSnapshot {
	readonly bindings: readonly VirtualPreviewBinding[];
	readonly activeRange: VirtualPreviewRange;
	readonly active: boolean;
}

export interface VirtualPreviewSurface {
	registerHost(key: string, element: HTMLElement): PreviewHostLease;
	/**
	 * Publishes the complete preview state for the currently managed virtual
	 * window. Callers should pass mounted/overscan cards, not the full result set.
	 */
	publish(snapshot: VirtualPreviewSurfaceSnapshot): void;
	dispose(): void;
}

export interface CreateVirtualPreviewSurfaceOptions {
	readonly frameCoordinator: VirtualFrameCoordinator;
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
	lastSeenSnapshotGeneration: number;
}

const PREVIEW_SURFACE_FLUSH_KEY = "virtual-preview-surface:flush";
const DISABLED_PREVIEW_HOST_LEASE: PreviewHostLease = { dispose: () => {} };

function compareBindingsByDescendingRow(
	left: VirtualPreviewBinding,
	right: VirtualPreviewBinding,
): number {
	return right.rowIndex - left.rowIndex;
}

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
	const hostsByKey = new Map<string, Set<PreviewHostRegistration>>();
	const pendingByKey = new Map<string, PreviewActivationHandle>();
	const backwardActivationOrderScratch: VirtualPreviewBinding[] = [];
	const activationScheduler = options.activationScheduler;
	const scope: PreviewActivationScope = activationScheduler.createScope({
		frameCoordinator: options.frameCoordinator,
	});
	let latestSnapshot: VirtualPreviewSurfaceSnapshot | undefined;
	let lastAppliedActiveStart: number | undefined;
	let appliedSnapshotGeneration = 0;
	let lastAppliedActive = false;
	let disposed = false;

	function getOrCreateEntry(key: string): PreviewEntryRuntime {
		const existing = entriesByKey.get(key);
		if (existing) return existing;
		const entry: PreviewEntryRuntime = {
			key,
			controller: createPreviewSlotController(options.createRenderer),
			lastSeenSnapshotGeneration: 0,
		};
		entriesByKey.set(key, entry);
		for (const registration of hostsByKey.get(key) ?? []) {
			registration.controllerLease = entry.controller.attachHost(
				registration.element,
			);
		}
		return entry;
	}

	function scheduleFlush(): void {
		options.frameCoordinator.schedule(
			"post-paint",
			PREVIEW_SURFACE_FLUSH_KEY,
			applyLatestSnapshot,
		);
	}

	function activateQueuedEntry(key: string): void {
		if (disposed) return;
		pendingByKey.delete(key);
		entriesByKey.get(key)?.controller.activate();
	}

	function enqueueActivation(key: string): void {
		if (pendingByKey.has(key)) return;
		const handle = scope.request(key, () => {
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

	function cancelAllPendingActivations(): void {
		for (const handle of pendingByKey.values()) handle.cancel();
		pendingByKey.clear();
	}

	function reconcileActivation(entry: PreviewEntryRuntime): void {
		if (entry.controller.needsActivation()) {
			enqueueActivation(entry.key);
			return;
		}
		cancelPendingActivation(entry.key);
	}

	function disposeEntry(entry: PreviewEntryRuntime): void {
		cancelPendingActivation(entry.key);
		for (const registration of hostsByKey.get(entry.key) ?? []) {
			registration.controllerLease?.dispose();
			registration.controllerLease = undefined;
		}
		entry.controller.dispose();
		entriesByKey.delete(entry.key);
		options.onEntryDisposed?.(entry.key);
	}

	function applyLatestSnapshot(): void {
		if (disposed || !latestSnapshot) return;
		const snapshot = latestSnapshot;
		appliedSnapshotGeneration += 1;
		const snapshotGeneration = appliedSnapshotGeneration;
		const movedBackward =
			snapshot.active &&
			lastAppliedActive &&
			lastAppliedActiveStart !== undefined &&
			snapshot.activeRange.start < lastAppliedActiveStart;

		// The activation scheduler is FIFO. When the preview window moves backward,
		// cancel the old queue and rebuild it from the bottom row toward the top so
		// previews fill in the same direction as the reverse scroll. Keep the original
		// order within a row so columns do not flip left-to-right.
		if (movedBackward) cancelAllPendingActivations();
		let bindingsInActivationOrder = snapshot.bindings;
		if (movedBackward) {
			for (const binding of snapshot.bindings) {
				backwardActivationOrderScratch.push(binding);
			}
			backwardActivationOrderScratch.sort(compareBindingsByDescendingRow);
			bindingsInActivationOrder = backwardActivationOrderScratch;
		}

		for (const binding of bindingsInActivationOrder) {
			const entry = getOrCreateEntry(binding.key);
			entry.lastSeenSnapshotGeneration = snapshotGeneration;
			entry.controller.bind(binding.request);
			entry.controller.setActive(
				snapshot.active &&
					binding.rowIndex >= snapshot.activeRange.start &&
					binding.rowIndex < snapshot.activeRange.end,
			);
			reconcileActivation(entry);
		}
		backwardActivationOrderScratch.length = 0;

		for (const entry of entriesByKey.values()) {
			if (entry.lastSeenSnapshotGeneration !== snapshotGeneration) {
				disposeEntry(entry);
			}
		}

		lastAppliedActiveStart = snapshot.activeRange.start;
		lastAppliedActive = snapshot.active;
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
			reconcileActivation(entry);
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
				if (activeEntry) reconcileActivation(activeEntry);
			},
		};
	}

	function publish(snapshot: VirtualPreviewSurfaceSnapshot): void {
		if (disposed) return;
		latestSnapshot = snapshot;
		scheduleFlush();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		latestSnapshot = undefined;
		options.frameCoordinator.cancel("post-paint", PREVIEW_SURFACE_FLUSH_KEY);
		for (const handle of pendingByKey.values()) handle.cancel();
		pendingByKey.clear();
		backwardActivationOrderScratch.length = 0;
		for (const registrations of hostsByKey.values()) {
			for (const registration of registrations) {
				registration.controllerLease?.dispose();
			}
		}
		hostsByKey.clear();
		for (const entry of entriesByKey.values()) entry.controller.dispose();
		entriesByKey.clear();
		scope.dispose();
	}

	return { registerHost, publish, dispose };
}
