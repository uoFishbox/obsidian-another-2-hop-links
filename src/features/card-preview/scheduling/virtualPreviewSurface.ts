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

export interface VirtualPreviewBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly ownerKey: string;
	readonly request: CardPreviewRequest;
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
	/** Realm used by the flush driver when no coordinator accepts the task. */
	readonly getWindow?: () => Window | null;
	readonly activationScheduler: PreviewActivationScheduler;
	readonly createRenderer: () => CardPreviewRenderer;
	/** Optional lifecycle probe invoked after an unbound slot runtime is released. */
	readonly onSlotDisposed?: (slotId: string) => void;
}

interface PreviewHostRegistration {
	readonly element: HTMLElement;
	controllerLease?: PreviewHostLease;
}

interface PreviewSlotRuntime {
	readonly slotId: string;
	readonly controller: PreviewSlotController;
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
	const slotIdsByRow = new Map<number, Set<string>>();
	const hostsBySlotId = new Map<string, Set<PreviewHostRegistration>>();
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
		getWindow: options.getWindow,
		onFrame: applyDesiredState,
	});

	function getOrCreateSlot(slotId: string): PreviewSlotRuntime {
		const existing = slotsById.get(slotId);
		if (existing) return existing;
		const slot: PreviewSlotRuntime = {
			slotId,
			controller: createPreviewSlotController({
				createRenderer: options.createRenderer,
			}),
			seenBindingEpoch: 0,
			dirty: false,
		};
		slotsById.set(slotId, slot);
		for (const registration of hostsBySlotId.get(slotId) ?? []) {
			registration.controllerLease = slot.controller.attachHost(
				registration.element,
			);
		}
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
		if (slot.binding || slot.desiredBinding) return;
		if (slot.dirty) return;
		if (pendingBySlotId.has(slot.slotId)) return;
		removeSlotFromRow(slot.slotId, slot.rowIndex);
		for (const registration of hostsBySlotId.get(slot.slotId) ?? []) {
			registration.controllerLease?.dispose();
			registration.controllerLease = undefined;
		}
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

	function addSlotToRow(slotId: string, rowIndex: number | undefined): void {
		if (rowIndex === undefined) return;
		let slotIds = slotIdsByRow.get(rowIndex);
		if (!slotIds) {
			slotIds = new Set();
			slotIdsByRow.set(rowIndex, slotIds);
		}
		slotIds.add(slotId);
	}

	function removeSlotFromRow(slotId: string, rowIndex: number | undefined): void {
		if (rowIndex === undefined) return;
		const slotIds = slotIdsByRow.get(rowIndex);
		if (!slotIds) return;
		slotIds.delete(slotId);
		if (slotIds.size === 0) slotIdsByRow.delete(rowIndex);
	}

	function applyDirtyBinding(slot: PreviewSlotRuntime): void {
		const previousRowIndex = slot.rowIndex;
		if (slot.desiredBinding) {
			slot.controller.bind(slot.desiredBinding);
			slot.binding = slot.desiredBinding;
			slot.rowIndex = slot.desiredRowIndex;
		} else {
			slot.controller.clear();
			slot.binding = undefined;
			slot.rowIndex = undefined;
		}
		if (previousRowIndex !== slot.rowIndex) {
			removeSlotFromRow(slot.slotId, previousRowIndex);
			addSlotToRow(slot.slotId, slot.rowIndex);
		}
		slot.dirty = false;
	}

	function reconcileRow(rowIndex: number): void {
		for (const slotId of slotIdsByRow.get(rowIndex) ?? []) {
			const slot = slotsById.get(slotId);
			if (slot) reconcileSlot(slot);
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
		const dirtySnapshot = [...dirtySlots];

		appliedRangeActive = desiredRangeActive;
		appliedRangeStart = desiredRangeStart;
		appliedRangeEnd = desiredRangeEnd;

		for (const slot of dirtySnapshot) applyDirtyBinding(slot);

		if (rangeChanged) {
			const oldStart = previousRangeActive ? previousRangeStart : 0;
			const oldEnd = previousRangeActive ? previousRangeEnd : 0;
			const nextStart = desiredRangeActive ? desiredRangeStart : 0;
			const nextEnd = desiredRangeActive ? desiredRangeEnd : 0;
			reconcileRangeDifference(oldStart, oldEnd, nextStart, nextEnd);
			reconcileRangeDifference(nextStart, nextEnd, oldStart, oldEnd);
		}
		for (const slot of dirtySnapshot) reconcileSlot(slot);

		for (const slot of dirtySnapshot) maybeDisposeSlot(slot);
		dirtySlots.clear();
	}

	function registerHost(slotId: string, element: HTMLElement): PreviewHostLease {
		if (disposed) return DISABLED_PREVIEW_HOST_LEASE;
		const registration: PreviewHostRegistration = { element };
		let registrations = hostsBySlotId.get(slotId);
		if (!registrations) {
			registrations = new Set();
			hostsBySlotId.set(slotId, registrations);
		}
		registrations.add(registration);
		const slot = slotsById.get(slotId);
		if (slot) {
			registration.controllerLease = slot.controller.attachHost(element);
			reconcileSlot(slot);
		}
		let disposedLease = false;
		return {
			dispose(): void {
				if (disposedLease) return;
				disposedLease = true;
				registration.controllerLease?.dispose();
				registration.controllerLease = undefined;
				registrations?.delete(registration);
				if (registrations?.size === 0) hostsBySlotId.delete(slotId);
				const activeSlot = slotsById.get(slotId);
				if (!activeSlot) return;
				reconcileSlot(activeSlot);
				maybeDisposeSlot(activeSlot);
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
		for (const registrations of hostsBySlotId.values()) {
			for (const registration of registrations) {
				registration.controllerLease?.dispose();
			}
		}
		hostsBySlotId.clear();
		for (const slot of slotsById.values()) slot.controller.dispose();
		slotsById.clear();
		slotIdsByRow.clear();
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
