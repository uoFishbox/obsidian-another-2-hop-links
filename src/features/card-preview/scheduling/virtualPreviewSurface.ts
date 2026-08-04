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
	type PreviewSlotController,
	type PreviewSlotPhase,
} from "features/card-preview/ui/previewSlotController";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import type {
	PreviewFrame,
	RowPreviewCardBinding,
	RowPreviewWindow,
} from "./rowPreviewTypes";

export type {
	PreviewFrame,
	RowPreviewCardBinding,
	RowPreviewWindow,
} from "./rowPreviewTypes";
export type PreviewHostPhase = PreviewSlotPhase;

export interface PreviewHostLease {
	dispose(): void;
}

export interface VirtualPreviewSurface {
	registerHost(slotId: string, element: HTMLElement): PreviewHostLease;
	/** Publishes one immutable desired frame for the whole surface. */
	publish(frame: PreviewFrame): void;
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
	binding?: RowPreviewCardBinding;
	rowIndex?: number;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };
const PREVIEW_SIDECAR_FLUSH_KEY = "two-hop:preview-sidecar-flush";
const DISABLED_PREVIEW_HOST_LEASE: PreviewHostLease = { dispose: () => {} };

/** Owns frame reconciliation and activation policy for one virtual surface. */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const slotsById = new Map<string, PreviewSlotRuntime>();
	const pendingBySlotId = new Map<string, PreviewActivationHandle>();
	const activationScheduler = options.activationScheduler;
	const scope: PreviewActivationScope = activationScheduler.createScope({
		frameCoordinator: options.frameCoordinator,
	});
	let previewRange: RowRange = EMPTY_RANGE;
	let desiredFrame: PreviewFrame | undefined;
	let appliedFrame: PreviewFrame | undefined;
	let disposed = false;
	const frameFlushDriver = createPreviewFrameDriver({
		coordinator: options.frameCoordinator,
		taskKey: PREVIEW_SIDECAR_FLUSH_KEY,
		onFrame: applyDesiredFrame,
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
		};
		slotsById.set(slotId, slot);
		return slot;
	}

	function maybeDisposeSlot(slot: PreviewSlotRuntime): void {
		if (slot.hostLeaseCount > 0) return;
		if (slot.binding) return;
		if (pendingBySlotId.has(slot.slotId)) return;
		slot.controller.dispose();
		slotsById.delete(slot.slotId);
		options.onSlotDisposed?.(slot.slotId);
	}

	function isInPreviewRange(slot: PreviewSlotRuntime): boolean {
		return (
			slot.rowIndex !== undefined &&
			slot.rowIndex >= previewRange.start &&
			slot.rowIndex < previewRange.end
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
		const isActive = Boolean(slot.binding && isInPreviewRange(slot));
		slot.controller.setActive(isActive);
		if (isActive && slot.controller.needsActivation()) {
			enqueueActivation(slot.slotId);
			return;
		}
		cancelPendingActivation(slot.slotId);
	}

	function reconcile(): void {
		for (const slot of slotsById.values()) reconcileSlot(slot);
		for (const slot of slotsById.values()) maybeDisposeSlot(slot);
	}

	function applyDesiredFrame(): void {
		if (disposed) return;
		const frame = desiredFrame;
		if (!frame) return;
		const desiredBindings = frame.previewBindingsBySlot;
		const appliedBindings = appliedFrame?.previewBindingsBySlot;
		previewRange = frame.previewWindow.active
			? frame.previewWindow.previewRange
			: EMPTY_RANGE;

		if (appliedBindings) {
			for (const slotId of appliedBindings.keys()) {
				if (desiredBindings.has(slotId)) continue;
				const slot = slotsById.get(slotId);
				if (!slot) continue;
				slot.binding = undefined;
				slot.rowIndex = undefined;
				slot.controller.clear();
			}
		}
		// Bind every final desired slot idempotently. A staged A -> B -> A sequence
		// invalidates A before this flush even though its final reference is unchanged.
		for (const binding of desiredBindings.values()) {
			const slot = getOrCreateSlot(binding.slotId);
			slot.binding = binding;
			slot.rowIndex = binding.rowIndex;
			slot.controller.bind({
				ownerKey: binding.ownerKey,
				request: binding.request,
			});
		}
		appliedFrame = frame;
		reconcile();
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

	function publish(frame: PreviewFrame): void {
		if (disposed) return;
		assertImmutablePreviewFrame(frame);
		if (desiredFrame === frame) return;

		const previousDesired = desiredFrame;
		const previousBindings = previousDesired?.previewBindingsBySlot;
		const nextBindings = frame.previewBindingsBySlot;
		let bindingsChanged = false;
		if (previousBindings) {
			for (const slotId of previousBindings.keys()) {
				if (nextBindings.has(slotId)) continue;
				bindingsChanged = true;
				slotsById.get(slotId)?.controller.invalidate();
			}
		}
		for (const [slotId, binding] of nextBindings) {
			const previousBinding = previousBindings?.get(slotId);
			if (previousBinding === binding) continue;

			bindingsChanged = true;
			if (!previousBinding || !isSameDesiredBinding(previousBinding, binding)) {
				slotsById.get(slotId)?.controller.invalidate();
			}
		}
		desiredFrame = frame;

		const previousRange = previousDesired?.previewWindow.active
			? previousDesired.previewWindow.previewRange
			: EMPTY_RANGE;
		const nextRange = frame.previewWindow.active
			? frame.previewWindow.previewRange
			: EMPTY_RANGE;
		const hasChanges =
			bindingsChanged ||
			nextRange.start !== previousRange.start ||
			nextRange.end !== previousRange.end;
		if (!hasChanges) return;
		frameFlushDriver.schedule({ lane: "post-paint" });
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		frameFlushDriver.dispose();
		desiredFrame = undefined;
		appliedFrame = undefined;
		for (const handle of pendingBySlotId.values()) handle.cancel();
		pendingBySlotId.clear();
		for (const slot of slotsById.values()) slot.controller.dispose();
		slotsById.clear();
		activationScheduler.disposeScope(scope);
	}

	return { registerHost, publish, dispose };
}

function isSameDesiredBinding(
	left: RowPreviewCardBinding,
	right: RowPreviewCardBinding,
): boolean {
	return (
		left.ownerKey === right.ownerKey &&
		left.request.renderKey === right.request.renderKey &&
		left.rowIndex === right.rowIndex
	);
}

interface PreviewBindingSnapshot {
	readonly ownerKey: string;
	readonly request: CardPreviewRequest;
	readonly renderKey: string;
	readonly rowIndex: number;
	readonly slotId: string;
}

interface PreviewFrameSnapshot {
	readonly bindings: ReadonlyMap<string, RowPreviewCardBinding>;
	readonly entries: readonly (readonly [string, RowPreviewCardBinding])[];
	readonly window: RowPreviewWindow;
	readonly active: boolean;
	readonly rangeStart: number;
	readonly rangeEnd: number;
}

const bindingSnapshots = new WeakMap<RowPreviewCardBinding, PreviewBindingSnapshot>();
const frameSnapshots = new WeakMap<PreviewFrame, PreviewFrameSnapshot>();

function assertImmutablePreviewFrame(frame: PreviewFrame): void {
	if (process.env.NODE_ENV === "production") return;

	const previousFrame = frameSnapshots.get(frame);
	if (previousFrame) {
		const entries = Array.from(frame.previewBindingsBySlot.entries());
		const entriesChanged =
			entries.length !== previousFrame.entries.length ||
			entries.some(
				(entry, index) =>
					entry[0] !== previousFrame.entries[index]?.[0] ||
					entry[1] !== previousFrame.entries[index]?.[1],
			);
		if (
			frame.previewBindingsBySlot !== previousFrame.bindings ||
			frame.previewWindow !== previousFrame.window ||
			frame.previewWindow.active !== previousFrame.active ||
			frame.previewWindow.previewRange.start !== previousFrame.rangeStart ||
			frame.previewWindow.previewRange.end !== previousFrame.rangeEnd ||
			entriesChanged
		) {
			throw new TypeError("PreviewFrame must not be mutated after publication");
		}
	}

	for (const [slotId, binding] of frame.previewBindingsBySlot) {
		if (binding.slotId !== slotId) {
			throw new TypeError("Preview binding slotId must match its frame key");
		}
		const previousBinding = bindingSnapshots.get(binding);
		const requestDescriptor = Object.getOwnPropertyDescriptor(binding, "request");
		const currentRequest =
			requestDescriptor && "value" in requestDescriptor
				? (requestDescriptor.value as CardPreviewRequest)
				: (previousBinding?.request ?? binding.request);
		if (
			previousBinding &&
			(previousBinding.ownerKey !== binding.ownerKey ||
				previousBinding.request !== currentRequest ||
				previousBinding.renderKey !== currentRequest.renderKey ||
				previousBinding.rowIndex !== binding.rowIndex ||
				previousBinding.slotId !== binding.slotId)
		) {
			throw new TypeError(
				"RowPreviewCardBinding must not be mutated after publication",
			);
		}
		bindingSnapshots.set(binding, {
			ownerKey: binding.ownerKey,
			request: currentRequest,
			renderKey: currentRequest.renderKey,
			rowIndex: binding.rowIndex,
			slotId: binding.slotId,
		});
	}
	frameSnapshots.set(frame, {
		bindings: frame.previewBindingsBySlot,
		entries: Array.from(frame.previewBindingsBySlot.entries()),
		window: frame.previewWindow,
		active: frame.previewWindow.active,
		rangeStart: frame.previewWindow.previewRange.start,
		rangeEnd: frame.previewWindow.previewRange.end,
	});
}
