import {
	type PreviewActivationHandle,
	type PreviewActivationScheduler,
	type PreviewActivationScope,
} from "./previewActivationScheduler";
import { createPreviewFrameDriver } from "./previewFrameDriver";
import type { CardPreviewRenderer } from "features/preview/ui/cardPreviewRenderer";
import type { CardPreviewRequest } from "features/preview/core/cardPreviewRequest";
import {
	createPreviewSlotController,
	type PreviewSlotController,
	type PreviewSlotPhase,
} from "features/preview/ui/previewSlotController";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import type {
	PreviewFrame,
	RowPreviewBindingDelta,
	RowPreviewCardBinding,
	RowPreviewWindow,
} from "./rowPreviewTypes";

export type {
	PreviewFrame,
	RowPreviewBindingDelta,
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
	readonly hasCachedPreview: (renderKey: string) => boolean;
}

interface PreviewSlotRuntime {
	readonly slotId: string;
	readonly controller: PreviewSlotController;
	binding?: RowPreviewCardBinding;
	rowIndex?: number;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };
const PREVIEW_SIDECAR_FLUSH_KEY = "two-hop:preview-sidecar-flush";

/** Owns frame reconciliation and activation policy for one virtual surface. */
export function createVirtualPreviewSurface(
	options: CreateVirtualPreviewSurfaceOptions,
): VirtualPreviewSurface {
	const slotsById = new Map<string, PreviewSlotRuntime>();
	const pendingBySlotId = new Map<string, PreviewActivationHandle>();
	const activationSlotIds = new Set<string>();
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
			controller: createPreviewSlotController({
				createRenderer: options.createRenderer,
				hasCachedPreview: options.hasCachedPreview,
			}),
		};
		slotsById.set(slotId, slot);
		return slot;
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

	function reconcile(): void {
		activationSlotIds.clear();
		for (const slot of slotsById.values()) {
			const isActive = Boolean(slot.binding && isInPreviewRange(slot));
			slot.controller.setActive(isActive);
			if (!isActive || !slot.controller.needsActivation()) continue;
			if (slot.controller.hasCachedPreview()) slot.controller.activate();
			else activationSlotIds.add(slot.slotId);
		}
		for (const [slotId, handle] of pendingBySlotId) {
			if (activationSlotIds.has(slotId)) continue;
			handle.cancel();
			pendingBySlotId.delete(slotId);
		}
		for (const slotId of activationSlotIds) enqueueActivation(slotId);
		activationSlotIds.clear();
	}

	function applyDesiredFrame(): void {
		if (disposed) return;
		const frame = desiredFrame;
		if (!frame || frame === appliedFrame) return;
		const delta = diffPreviewBindings(
			appliedFrame?.previewBindingsBySlot,
			frame.previewBindingsBySlot,
		);
		previewRange = frame.previewWindow.active
			? frame.previewWindow.previewRange
			: EMPTY_RANGE;

		for (const slotId of delta.releasedSlots) {
			const slot = getOrCreateSlot(slotId);
			slot.binding = undefined;
			slot.rowIndex = undefined;
			slot.controller.clear();
		}
		for (const binding of [...delta.enteredSlots, ...delta.reboundSlots]) {
			const slot = getOrCreateSlot(binding.slotId);
			slot.binding = binding;
			slot.rowIndex = binding.rowIndex;
			slot.controller.bind({
				ownerToken: binding.ownerToken,
				request: binding.request,
			});
		}
		appliedFrame = frame;
		reconcile();
	}

	function registerHost(slotId: string, element: HTMLElement): PreviewHostLease {
		const slot = getOrCreateSlot(slotId);
		const lease = slot.controller.attachHost(element);
		reconcile();
		return lease;
	}

	function publish(frame: PreviewFrame): void {
		if (disposed) return;
		assertImmutablePreviewFrame(frame);
		if (desiredFrame === frame) return;

		const previousDesired = desiredFrame;
		const delta = diffPreviewBindings(
			previousDesired?.previewBindingsBySlot,
			frame.previewBindingsBySlot,
		);
		desiredFrame = frame;
		for (const slotId of delta.releasedSlots) {
			getOrCreateSlot(slotId).controller.invalidate();
		}
		for (const binding of [...delta.enteredSlots, ...delta.reboundSlots]) {
			const previousBinding = previousDesired?.previewBindingsBySlot.get(
				binding.slotId,
			);
			if (previousBinding && isSameDesiredBinding(previousBinding, binding)) {
				continue;
			}
			getOrCreateSlot(binding.slotId).controller.invalidate();
		}

		const previousRange = previousDesired?.previewWindow.active
			? previousDesired.previewWindow.previewRange
			: EMPTY_RANGE;
		const nextRange = frame.previewWindow.active
			? frame.previewWindow.previewRange
			: EMPTY_RANGE;
		const hasChanges =
			delta.enteredSlots.length > 0 ||
			delta.reboundSlots.length > 0 ||
			delta.releasedSlots.length > 0 ||
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
		activationSlotIds.clear();
		activationScheduler.disposeScope(scope);
	}

	return { registerHost, publish, dispose };
}

function diffPreviewBindings(
	previous: ReadonlyMap<string, RowPreviewCardBinding> | undefined,
	next: ReadonlyMap<string, RowPreviewCardBinding>,
): RowPreviewBindingDelta {
	const enteredSlots: RowPreviewCardBinding[] = [];
	const reboundSlots: RowPreviewCardBinding[] = [];
	const releasedSlots: string[] = [];
	for (const slotId of previous?.keys() ?? []) {
		if (!next.has(slotId)) releasedSlots.push(slotId);
	}
	for (const [slotId, binding] of next) {
		const previousBinding = previous?.get(slotId);
		if (!previousBinding) enteredSlots.push(binding);
		else if (previousBinding !== binding) reboundSlots.push(binding);
	}
	return { enteredSlots, reboundSlots, releasedSlots };
}

function isSameDesiredBinding(
	left: RowPreviewCardBinding,
	right: RowPreviewCardBinding,
): boolean {
	return (
		left.ownerToken === right.ownerToken &&
		left.request.renderKey === right.request.renderKey &&
		left.rowIndex === right.rowIndex
	);
}

interface PreviewBindingSnapshot {
	readonly ownerToken: object;
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
			(previousBinding.ownerToken !== binding.ownerToken ||
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
			ownerToken: binding.ownerToken,
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
