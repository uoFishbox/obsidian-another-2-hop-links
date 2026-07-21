import {
	createPreviewActivationScope,
	requestQueuedPreviewActivation,
	type PreviewActivationHandle,
	type PreviewActivationScope,
	type PreviewBackpressure,
} from "./previewActivationScheduler";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import type { RowRange } from "ui/virtualization/rowRange";
import type {
	CardPreviewSlotState,
	CardPreviewSnapshot,
} from "features/preview/ui/cardPreviewSnapshot";

export interface RowPreviewCardBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly snapshot: CardPreviewSnapshot;
}

export interface RowPreviewController {
	/** Rebinds the bounded physical slots to their current logical cards. */
	syncCards(cards: readonly RowPreviewCardBinding[]): void;
	/** Applies the final preview range; slots outside it lose their snapshot. */
	setPreviewRange(range: RowRange): void;
	getSlotState(slotId: string): CardPreviewSlotState | undefined;
	dispose(): void;
}

export interface CreateRowPreviewControllerOptions {
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly frameCoordinator?: VirtualFrameCoordinator;
}

interface MutableCardPreviewSlotState {
	snapshot: CardPreviewSnapshot | undefined;
}

interface BoundSlot {
	readonly binding: RowPreviewCardBinding;
	readonly state: MutableCardPreviewSlotState;
}

/**
 * Owns preview activation for one virtual surface.
 *
 * Activation is recomputed from the current card bindings and the last applied
 * preview range rather than from incremental row visibility deltas. Slots bound
 * to the same activation identity are activated together, and slots leaving the
 * preview range or being rebound to a different card release their snapshot.
 */
export function createRowPreviewController(
	options: CreateRowPreviewControllerOptions = {},
): RowPreviewController {
	const slotsById = new Map<string, BoundSlot>();
	const pendingByKey = new Map<string, PreviewActivationHandle>();
	const scope: PreviewActivationScope = createPreviewActivationScope({
		getBackpressure: options.getBackpressure,
		frameCoordinator: options.frameCoordinator,
	});
	let previewRange: RowRange = { start: 0, end: 0 };
	let disposed = false;

	function getOrCreateState(slotId: string): MutableCardPreviewSlotState {
		const existing = slotsById.get(slotId);
		if (existing) return existing.state;

		const state = $state<MutableCardPreviewSlotState>({ snapshot: undefined });
		return state;
	}

	function isRowInPreviewRange(rowIndex: number): boolean {
		return rowIndex >= previewRange.start && rowIndex < previewRange.end;
	}

	function activateCurrentSlots(key: string): void {
		if (disposed) return;
		for (const slot of slotsById.values()) {
			if (slot.binding.snapshot.identity !== key) continue;
			if (!isRowInPreviewRange(slot.binding.rowIndex)) continue;
			slot.state.snapshot = slot.binding.snapshot;
		}
	}

	function enqueueActivation(key: string): void {
		if (pendingByKey.has(key)) return;

		const handle = requestQueuedPreviewActivation(key, scope, () => {
			pendingByKey.delete(key);
			activateCurrentSlots(key);
		});
		pendingByKey.set(key, handle);
	}

	function bindCard(binding: RowPreviewCardBinding): void {
		const previous = slotsById.get(binding.slotId);
		if (
			previous &&
			previous.binding.rowIndex === binding.rowIndex &&
			previous.binding.snapshot.identity === binding.snapshot.identity
		) {
			return;
		}

		const state = previous?.state ?? getOrCreateState(binding.slotId);
		if (previous) {
			state.snapshot = undefined;
		}
		slotsById.set(binding.slotId, { binding, state });
	}

	function reconcile(): void {
		if (disposed) return;

		const keysNeedingActivation = new Set<string>();
		for (const slot of slotsById.values()) {
			if (!isRowInPreviewRange(slot.binding.rowIndex)) {
				slot.state.snapshot = undefined;
				continue;
			}
			if (!slot.state.snapshot) {
				keysNeedingActivation.add(slot.binding.snapshot.identity);
			}
		}

		for (const [key, handle] of pendingByKey) {
			if (keysNeedingActivation.has(key)) continue;
			handle.cancel();
			pendingByKey.delete(key);
		}

		for (const key of keysNeedingActivation) {
			enqueueActivation(key);
		}
	}

	function syncCards(cards: readonly RowPreviewCardBinding[]): void {
		if (disposed) return;

		const retainedSlots = new Set<string>();
		for (const card of cards) {
			retainedSlots.add(card.slotId);
			bindCard(card);
		}

		for (const [slotId, slot] of slotsById) {
			if (retainedSlots.has(slotId)) continue;
			slot.state.snapshot = undefined;
			slotsById.delete(slotId);
		}

		reconcile();
	}

	function setPreviewRange(range: RowRange): void {
		if (disposed) return;
		previewRange = range;
		reconcile();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const handle of pendingByKey.values()) {
			handle.cancel();
		}
		pendingByKey.clear();
		for (const slot of slotsById.values()) {
			slot.state.snapshot = undefined;
		}
		slotsById.clear();
	}

	return {
		syncCards,
		setPreviewRange,
		getSlotState: (slotId) => slotsById.get(slotId)?.state,
		dispose,
	};
}
