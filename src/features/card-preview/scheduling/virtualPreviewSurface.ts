import {
	type PreviewActivationHandle,
	type PreviewActivationScheduler,
	type PreviewActivationScope,
} from "./previewActivationScheduler";
import { createPreviewFrameDriver } from "./previewFrameDriver";
import type { CardPreviewRenderer } from "features/card-preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "features/card-preview/core/cardPreviewRequest";
import {
	createPreviewSlotController,
	type PreviewBinding,
	type PreviewSlotController,
	type PreviewSlotPhase,
} from "features/card-preview/ui/previewSlotController";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

export type PreviewHostPhase = PreviewSlotPhase;

export interface PreviewHostLease {
	dispose(): void;
}

export interface VirtualPreviewSurface {
	registerHost(slotId: string, element: HTMLElement): PreviewHostLease;
	/** Starts publication of the complete desired binding set for this surface. */
	beginBindings(): void;
	/** Stages one desired slot binding in the current publication pass. */
	bindSlot(
		slotId: string,
		rowIndex: number,
		ownerKey: string,
		request: CardPreviewRequest,
	): void;
	/** Releases bindings omitted from the current pass and schedules one flush. */
	endBindings(): void;
	/** Updates the active preview row range without rebuilding slot bindings. */
	setActiveRange(start: number, end: number, active: boolean): void;
	dispose(): void;
}

export interface CreateVirtualPreviewSurfaceOptions {
	readonly frameCoordinator?: VirtualFrameCoordinator;
	readonly activationScheduler: PreviewActivationScheduler;
	readonly createRenderer: () => CardPreviewRenderer;
	/** Optional lifecycle probe invoked after a hostless, unbound slot is released. */
	readonly onSlotDisposed?: (slotId: string) => void;
}

interface PreviewSlotRuntime {
	readonly slotId: string;
	readonly controller: PreviewSlotController;
	hostLeaseCount: number;
	binding?: PreviewBinding;
	rowIndex?: number;
	desiredBinding?: PreviewBinding;
	desiredRowIndex?: number;
	seenBindingEpoch: number;
	dirty: boolean;
}

const PREVIEW_SURFACE_FLUSH_KEY = "virtual-preview-surface:flush";
const DISABLED_PREVIEW_HOST_LEASE: PreviewHostLease = { dispose: () => {} };

/** Owns staged slot bindings and activation policy for one virtual surface. */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const slotsById = new Map<string, PreviewSlotRuntime>();
	const dirtySlots = new Set<PreviewSlotRuntime>();
	const pendingBySlotId = new Map<string, PreviewActivationHandle>();
	const activationScheduler = options.activationScheduler;
	const scope: PreviewActivationScope = activationScheduler.createScope({
		frameCoordinator: options.frameCoordinator,
	});
	let bindingEpoch = 0;
	let bindingPassActive = false;
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
		onFrame: applyDesiredState,
	});

	function getOrCreateSlot(slotId: string): PreviewSlotRuntime {
		const existing = slotsById.get(slotId);
		if (existing) return existing;
		const slot: PreviewSlotRuntime = {
			slotId,
			hostLeaseCount: 0,
			controller: createPreviewSlotController({
				createRenderer: options.createRenderer,
			}),
			seenBindingEpoch: 0,
			dirty: false,
		};
		slotsById.set(slotId, slot);
		return slot;
	}

	function markDirty(slot: PreviewSlotRuntime): void {
		if (slot.dirty) return;
		slot.dirty = true;
		dirtySlots.add(slot);
	}

	function scheduleFlush(): void {
		frameFlushDriver.schedule({ lane: "post-paint" });
	}

	function maybeDisposeSlot(slot: PreviewSlotRuntime): void {
		if (slot.hostLeaseCount > 0) return;
		if (slot.binding || slot.desiredBinding) return;
		if (slot.dirty) return;
		if (pendingBySlotId.has(slot.slotId)) return;
		slot.controller.dispose();
		slotsById.delete(slot.slotId);
		options.onSlotDisposed?.(slot.slotId);
	}

	function isInAppliedRange(slot: PreviewSlotRuntime): boolean {
		return (
			appliedRangeActive &&
			slot.rowIndex !== undefined &&
			slot.rowIndex >= appliedRangeStart &&
			slot.rowIndex < appliedRangeEnd
		);
	}

	function activateQueuedSlot(slotId: string): void {
		if (disposed) return;
		pendingBySlotId.delete(slotId);
		slotsById.get(slotId)?.controller.activate();
	}

	function enqueueActivation(slotId: string): void {
		if (pendingBySlotId.has(slotId)) return;
		const handle = activationScheduler.request(slotId, scope, () => {
			activateQueuedSlot(slotId);
		});
		pendingBySlotId.set(slotId, handle);
	}

	function cancelPendingActivation(slotId: string): void {
		const handle = pendingBySlotId.get(slotId);
		if (!handle) return;
		handle.cancel();
		pendingBySlotId.delete(slotId);
	}

	function reconcileSlot(slot: PreviewSlotRuntime): void {
		const isActive = Boolean(slot.binding && isInAppliedRange(slot));
		slot.controller.setActive(isActive);
		if (isActive && slot.controller.needsActivation()) {
			enqueueActivation(slot.slotId);
			return;
		}
		cancelPendingActivation(slot.slotId);
	}

	function applyDirtyBinding(slot: PreviewSlotRuntime): void {
		if (slot.desiredBinding) {
			slot.controller.bind(slot.desiredBinding);
			slot.binding = slot.desiredBinding;
			slot.rowIndex = slot.desiredRowIndex;
		} else {
			slot.controller.clear();
			slot.binding = undefined;
			slot.rowIndex = undefined;
		}
		slot.dirty = false;
	}

	function applyDesiredState(): void {
		if (disposed) return;
		const rangeChanged =
			desiredRangeActive !== appliedRangeActive ||
			desiredRangeStart !== appliedRangeStart ||
			desiredRangeEnd !== appliedRangeEnd;

		appliedRangeActive = desiredRangeActive;
		appliedRangeStart = desiredRangeStart;
		appliedRangeEnd = desiredRangeEnd;

		for (const slot of dirtySlots) applyDirtyBinding(slot);

		if (rangeChanged) {
			for (const slot of slotsById.values()) reconcileSlot(slot);
		} else {
			for (const slot of dirtySlots) reconcileSlot(slot);
		}

		for (const slot of dirtySlots) maybeDisposeSlot(slot);
		dirtySlots.clear();
	}

	function registerHost(slotId: string, element: HTMLElement): PreviewHostLease {
		if (disposed) return DISABLED_PREVIEW_HOST_LEASE;
		const slot = getOrCreateSlot(slotId);
		const lease = slot.controller.attachHost(element);
		slot.hostLeaseCount += 1;
		reconcileSlot(slot);
		let disposedLease = false;
		return {
			dispose(): void {
				if (disposedLease) return;
				disposedLease = true;
				lease.dispose();
				slot.hostLeaseCount = Math.max(0, slot.hostLeaseCount - 1);
				reconcileSlot(slot);
				maybeDisposeSlot(slot);
			},
		};
	}

	function beginBindings(): void {
		if (disposed) return;
		bindingEpoch += 1;
		bindingPassActive = true;
	}

	function bindSlot(
		slotId: string,
		rowIndex: number,
		ownerKey: string,
		request: CardPreviewRequest,
	): void {
		if (disposed || !bindingPassActive) return;
		const slot = getOrCreateSlot(slotId);
		slot.seenBindingEpoch = bindingEpoch;
		const previous = slot.desiredBinding;
		const identityChanged =
			!previous ||
			previous.ownerKey !== ownerKey ||
			previous.request.renderKey !== request.renderKey;
		const rowChanged = slot.desiredRowIndex !== rowIndex;
		if (!identityChanged && !rowChanged) return;

		if (identityChanged) {
			slot.controller.invalidate();
			slot.desiredBinding = { ownerKey, request };
		}
		slot.desiredRowIndex = rowIndex;
		markDirty(slot);
	}

	function endBindings(): void {
		if (disposed || !bindingPassActive) return;
		bindingPassActive = false;
		for (const slot of slotsById.values()) {
			if (!slot.desiredBinding) continue;
			if (slot.seenBindingEpoch === bindingEpoch) continue;
			slot.controller.invalidate();
			slot.desiredBinding = undefined;
			slot.desiredRowIndex = undefined;
			markDirty(slot);
		}
		if (dirtySlots.size > 0) scheduleFlush();
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
		bindingPassActive = false;
		frameFlushDriver.dispose();
		for (const handle of pendingBySlotId.values()) handle.cancel();
		pendingBySlotId.clear();
		dirtySlots.clear();
		for (const slot of slotsById.values()) slot.controller.dispose();
		slotsById.clear();
		activationScheduler.disposeScope(scope);
	}

	return {
		registerHost,
		beginBindings,
		bindSlot,
		endBindings,
		setActiveRange,
		dispose,
	};
}
