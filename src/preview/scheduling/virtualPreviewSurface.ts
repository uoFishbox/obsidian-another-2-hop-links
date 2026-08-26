import type { CardPreviewRequest } from "preview/pipeline/cardPreviewRequest";
import {
	createPreviewSlotController,
	type PreviewSlotController,
} from "preview/ui/previewSlotController";
import type { CardPreviewRenderer } from "preview/ui/cardPreviewRenderer";
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

/** Complete preview state for the currently mounted virtual window. */
export interface VirtualPreviewSurfaceSnapshot {
	readonly bindings: readonly VirtualPreviewBinding[];
	readonly visibleRange: VirtualPreviewRange;
	readonly prefetchRange: VirtualPreviewRange;
	readonly active: boolean;
}

export interface VirtualPreviewSurface {
	registerHost(key: string, element: HTMLElement): PreviewHostLease;
	publish(snapshot: VirtualPreviewSurfaceSnapshot): void;
	dispose(): void;
}

export interface CreateVirtualPreviewSurfaceOptions {
	readonly frameCoordinator: VirtualFrameCoordinator;
	readonly createRenderer: () => CardPreviewRenderer;
	readonly prefetchPreview: (
		request: CardPreviewRequest,
		signal: AbortSignal,
	) => Promise<void>;
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

interface PreviewPrefetchRuntime {
	readonly renderKey: string;
	readonly controller: AbortController;
	lastSeenSnapshotGeneration: number;
}

const PREVIEW_SURFACE_FLUSH_KEY = "virtual-preview-surface:flush";
const DISABLED_PREVIEW_HOST_LEASE: PreviewHostLease = { dispose: () => {} };

function isBindingInRange(
	binding: VirtualPreviewBinding,
	range: VirtualPreviewRange,
): boolean {
	return binding.rowIndex >= range.start && binding.rowIndex < range.end;
}

/** Reconciles visible render lifecycles separately from cancellable data prefetch. */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const entriesByKey = new Map<string, PreviewEntryRuntime>();
	const hostsByKey = new Map<string, Set<PreviewHostRegistration>>();
	const prefetchesByKey = new Map<string, PreviewPrefetchRuntime>();
	const visibleBindingsScratch: VirtualPreviewBinding[] = [];
	const prefetchBindingsScratch: VirtualPreviewBinding[] = [];
	let latestSnapshot: VirtualPreviewSurfaceSnapshot | undefined;
	let appliedSnapshotGeneration = 0;
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

	function disposeEntry(entry: PreviewEntryRuntime): void {
		for (const registration of hostsByKey.get(entry.key) ?? []) {
			registration.controllerLease?.dispose();
			registration.controllerLease = undefined;
		}
		entry.controller.dispose();
		entriesByKey.delete(entry.key);
		options.onEntryDisposed?.(entry.key);
	}

	function cancelPrefetch(key: string): void {
		const prefetch = prefetchesByKey.get(key);
		if (!prefetch) return;
		prefetchesByKey.delete(key);
		prefetch.controller.abort();
	}

	function startPrefetch(binding: VirtualPreviewBinding): void {
		if (binding.request.previewOverride) return;
		const existing = prefetchesByKey.get(binding.key);
		if (existing?.renderKey === binding.request.renderKey) return;
		if (existing) cancelPrefetch(binding.key);

		const controller = new AbortController();
		prefetchesByKey.set(binding.key, {
			renderKey: binding.request.renderKey,
			controller,
			lastSeenSnapshotGeneration: appliedSnapshotGeneration,
		});
		void options
			.prefetchPreview(binding.request, controller.signal)
			.catch(() => {});
	}

	function applyLatestSnapshot(): void {
		if (disposed || !latestSnapshot) return;
		const snapshot = latestSnapshot;
		const snapshotGeneration = ++appliedSnapshotGeneration;

		for (const binding of snapshot.bindings) {
			const visible =
				snapshot.active && isBindingInRange(binding, snapshot.visibleRange);
			const shouldPrefetch =
				snapshot.active &&
				!visible &&
				isBindingInRange(binding, snapshot.prefetchRange);
			if (visible) visibleBindingsScratch.push(binding);
			if (shouldPrefetch) prefetchBindingsScratch.push(binding);

			const existingPrefetch = prefetchesByKey.get(binding.key);
			if (!existingPrefetch) continue;
			if (existingPrefetch.renderKey !== binding.request.renderKey) {
				cancelPrefetch(binding.key);
				continue;
			}
			if (visible || shouldPrefetch) {
				existingPrefetch.lastSeenSnapshotGeneration = snapshotGeneration;
			}
		}

		for (const [key, prefetch] of prefetchesByKey) {
			if (prefetch.lastSeenSnapshotGeneration !== snapshotGeneration) {
				cancelPrefetch(key);
			}
		}

		for (const binding of snapshot.bindings) {
			const visible =
				snapshot.active && isBindingInRange(binding, snapshot.visibleRange);
			let entry = entriesByKey.get(binding.key);
			if (visible) entry ??= getOrCreateEntry(binding.key);
			if (!entry) continue;
			entry.lastSeenSnapshotGeneration = snapshotGeneration;
			entry.controller.bind(binding.request);
			entry.controller.setActive(visible);
			if (visible) entry.controller.activate();
		}

		// Visible renderers synchronously join matching shared requests before the
		// prefetch caller is detached, so promotion never aborts useful work.
		for (const binding of visibleBindingsScratch) cancelPrefetch(binding.key);
		for (const binding of prefetchBindingsScratch) startPrefetch(binding);
		visibleBindingsScratch.length = 0;
		prefetchBindingsScratch.length = 0;

		for (const entry of entriesByKey.values()) {
			if (entry.lastSeenSnapshotGeneration !== snapshotGeneration) {
				disposeEntry(entry);
			}
		}
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
			entry.controller.activate();
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
			},
		};
	}

	function publish(snapshot: VirtualPreviewSurfaceSnapshot): void {
		if (disposed) return;
		latestSnapshot = snapshot;
		options.frameCoordinator.schedule(
			"post-paint",
			PREVIEW_SURFACE_FLUSH_KEY,
			applyLatestSnapshot,
		);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		latestSnapshot = undefined;
		options.frameCoordinator.cancel("post-paint", PREVIEW_SURFACE_FLUSH_KEY);
		for (const key of prefetchesByKey.keys()) cancelPrefetch(key);
		visibleBindingsScratch.length = 0;
		prefetchBindingsScratch.length = 0;
		for (const registrations of hostsByKey.values()) {
			for (const registration of registrations) {
				registration.controllerLease?.dispose();
			}
		}
		hostsByKey.clear();
		for (const entry of entriesByKey.values()) entry.controller.dispose();
		entriesByKey.clear();
	}

	return { registerHost, publish, dispose };
}
