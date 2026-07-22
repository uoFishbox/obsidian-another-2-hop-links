import type {
	CardPreviewSlotState,
	CardPreviewSnapshot,
} from "features/preview/ui/cardPreviewSnapshot";
import type { RowRange } from "ui/virtualization/rowRange";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	createPreviewActivationScope,
	disposePreviewActivationScope,
	requestQueuedPreviewActivation,
	type PreviewActivationHandle,
	type PreviewActivationScope,
	type PreviewBackpressure,
	type PreviewBackpressureListener,
} from "./previewActivationScheduler";

export interface RowPreviewCardBinding {
	readonly slotId: string;
	readonly rowIndex: number;
	readonly snapshot: CardPreviewSnapshot;
}

export interface RowPreviewControllerCommit {
	readonly cards: readonly RowPreviewCardBinding[];
	readonly previewRange: RowRange;
	readonly active: boolean;
}

export interface RowPreviewWindow {
	readonly previewRange: RowRange;
	readonly active: boolean;
}

export interface RowPreviewController {
	/** Rebinds physical slots while retaining the current preview window. */
	syncBindings(cards: readonly RowPreviewCardBinding[]): void;
	/** Updates only the active preview window for the current bindings. */
	setPreviewWindow(input: RowPreviewWindow): void;
	/** Applies one complete virtual-surface snapshot and reconciles once. */
	commit(input: RowPreviewControllerCommit): void;
	getSlotState(slotId: string): CardPreviewSlotState | undefined;
	dispose(): void;
}

export interface CreateRowPreviewControllerOptions {
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureListener,
	) => () => void;
	readonly schedulerIdentity?: object;
	readonly frameCoordinator?: VirtualFrameCoordinator;
	/** Resolves the scrolling activation rate dynamically. */
	readonly getActivationsPerSecond?: () => number;
}

interface MutableCardPreviewSlotState {
	bindingIdentity: string;
	renderSnapshot: CardPreviewSnapshot | undefined;
}

interface BoundSlot {
	readonly binding: RowPreviewCardBinding;
	readonly state: MutableCardPreviewSlotState;
}

const EMPTY_RANGE: RowRange = { start: 0, end: 0 };

/** Owns preview activation for one virtual surface. */
export function createRowPreviewController(
	options: CreateRowPreviewControllerOptions = {},
): RowPreviewController {
	const slotsById = new Map<string, BoundSlot>();
	const pendingByKey = new Map<string, PreviewActivationHandle>();
	const retainedSlotsScratch = new Set<string>();
	const activationKeysScratch = new Set<string>();
	const scope: PreviewActivationScope = createPreviewActivationScope({
		getBackpressure: options.getBackpressure,
		subscribeBackpressure: options.subscribeBackpressure,
		schedulerIdentity: options.schedulerIdentity,
		frameCoordinator: options.frameCoordinator,
		getActivationsPerSecond: options.getActivationsPerSecond,
	});
	let previewRange: RowRange = EMPTY_RANGE;
	let disposed = false;

	function getOrCreateState(slotId: string): MutableCardPreviewSlotState {
		const existing = slotsById.get(slotId);
		if (existing) return existing.state;
		const state = $state<MutableCardPreviewSlotState>({
			bindingIdentity: "",
			renderSnapshot: undefined,
		});
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
			slot.state.renderSnapshot = slot.binding.snapshot;
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
		state.bindingIdentity = binding.snapshot.identity;
		state.renderSnapshot = undefined;
		slotsById.set(binding.slotId, { binding, state });
	}

	function syncCards(cards: readonly RowPreviewCardBinding[]): void {
		retainedSlotsScratch.clear();
		for (const card of cards) {
			retainedSlotsScratch.add(card.slotId);
			bindCard(card);
		}

		for (const [slotId, slot] of slotsById) {
			if (retainedSlotsScratch.has(slotId)) continue;
			slot.state.renderSnapshot = undefined;
			slotsById.delete(slotId);
		}
		retainedSlotsScratch.clear();
	}

	function reconcile(): void {
		activationKeysScratch.clear();
		for (const slot of slotsById.values()) {
			if (!isRowInPreviewRange(slot.binding.rowIndex)) {
				slot.state.renderSnapshot = undefined;
				continue;
			}
			if (!slot.state.renderSnapshot) {
				activationKeysScratch.add(slot.binding.snapshot.identity);
			}
		}

		for (const [key, handle] of pendingByKey) {
			if (activationKeysScratch.has(key)) continue;
			handle.cancel();
			pendingByKey.delete(key);
		}
		for (const key of activationKeysScratch) enqueueActivation(key);
		activationKeysScratch.clear();
	}

	function syncBindings(cards: readonly RowPreviewCardBinding[]): void {
		if (disposed) return;
		syncCards(cards);
		reconcile();
	}

	function setPreviewWindow(input: RowPreviewWindow): void {
		if (disposed) return;
		const nextPreviewRange = input.active ? input.previewRange : EMPTY_RANGE;
		if (
			previewRange.start === nextPreviewRange.start &&
			previewRange.end === nextPreviewRange.end
		) {
			return;
		}
		previewRange = nextPreviewRange;
		reconcile();
	}

	function commit(input: RowPreviewControllerCommit): void {
		if (disposed) return;
		previewRange = input.active ? input.previewRange : EMPTY_RANGE;
		syncCards(input.cards);
		reconcile();
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const handle of pendingByKey.values()) handle.cancel();
		pendingByKey.clear();
		for (const slot of slotsById.values()) slot.state.renderSnapshot = undefined;
		slotsById.clear();
		retainedSlotsScratch.clear();
		activationKeysScratch.clear();
		disposePreviewActivationScope(scope);
	}

	return {
		syncBindings,
		setPreviewWindow,
		commit,
		getSlotState: (slotId) => slotsById.get(slotId)?.state,
		dispose,
	};
}
