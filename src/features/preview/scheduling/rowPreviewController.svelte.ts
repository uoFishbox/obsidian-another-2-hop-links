import { registerPreviewActivationBackpressure } from "./previewActivationScheduler";
import type { PreviewActivationScope } from "./previewActivationScope";
import type {
	NormalizedRowPreviewVisibilityDelta,
	RowPreviewActivationRuntime,
} from "./rowPreviewActivationRuntime";
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
	/** Applies one controller-normalized row visibility update. */
	applyNormalizedVisibilityDelta(delta: NormalizedRowPreviewVisibilityDelta): void;
	getSlotState(slotId: string): CardPreviewSlotState | undefined;
	dispose(): void;
}

export interface CreateRowPreviewControllerOptions {
	readonly runtime: RowPreviewActivationRuntime;
	readonly scope: PreviewActivationScope;
	readonly getQueuedPreviewJobs?: () => number;
	readonly getActivePreviewJobs?: () => number;
}

interface MutableCardPreviewSlotState {
	snapshot: CardPreviewSnapshot | undefined;
}

interface BoundCard {
	readonly binding: RowPreviewCardBinding;
	readonly state: MutableCardPreviewSlotState;
	readonly unregister: () => void;
}

/**
 * Owns preview activation for one virtual surface.
 *
 * Candidate registration follows physical slot rebinds, while visibility is
 * applied in row batches. Card components only consume the resulting state.
 */
export function createRowPreviewController(
	options: CreateRowPreviewControllerOptions,
): RowPreviewController {
	const cardsBySlot = new Map<string, BoundCard>();
	const statesBySlot = new Map<string, MutableCardPreviewSlotState>();
	let disposed = false;
	const unregisterBackpressure = options.getQueuedPreviewJobs
		? registerPreviewActivationBackpressure(options.scope, {
				getQueuedPreviewJobs: options.getQueuedPreviewJobs,
				getActivePreviewJobs: options.getActivePreviewJobs,
			})
		: undefined;

	function getOrCreateState(slotId: string): MutableCardPreviewSlotState {
		const existing = statesBySlot.get(slotId);
		if (existing) return existing;

		const state = $state<MutableCardPreviewSlotState>({ snapshot: undefined });
		statesBySlot.set(slotId, state);
		return state;
	}

	function bindCard(binding: RowPreviewCardBinding): void {
		const previous = cardsBySlot.get(binding.slotId);
		if (
			previous?.binding.rowIndex === binding.rowIndex &&
			previous.binding.snapshot.identity === binding.snapshot.identity
		) {
			return;
		}

		previous?.unregister();
		const state = previous?.state ?? getOrCreateState(binding.slotId);
		state.snapshot = undefined;
		const unregister = options.runtime.registerCandidate({
			id: binding.slotId,
			rowIndex: binding.rowIndex,
			activationKey: binding.snapshot.identity,
			onActivated: (activationKey) => {
				const current = cardsBySlot.get(binding.slotId);
				if (
					current?.binding !== binding ||
					activationKey !== binding.snapshot.identity
				) {
					return;
				}

				state.snapshot = binding.snapshot;
			},
		});
		cardsBySlot.set(binding.slotId, { binding, state, unregister });
	}

	function syncCards(cards: readonly RowPreviewCardBinding[]): void {
		if (disposed) return;

		const retainedSlots = new Set<string>();
		for (const card of cards) {
			retainedSlots.add(card.slotId);
			bindCard(card);
		}

		for (const [slotId, card] of cardsBySlot) {
			if (retainedSlots.has(slotId)) continue;
			card.unregister();
			card.state.snapshot = undefined;
			cardsBySlot.delete(slotId);
			statesBySlot.delete(slotId);
		}
	}

	function clearRows(rowIndices: ReadonlySet<number>): void {
		if (rowIndices.size === 0) return;
		for (const card of cardsBySlot.values()) {
			if (rowIndices.has(card.binding.rowIndex)) {
				card.state.snapshot = undefined;
			}
		}
	}

	function applyNormalizedVisibilityDelta(
		delta: NormalizedRowPreviewVisibilityDelta,
	): void {
		if (disposed) return;

		clearRows(delta.deactivatedRows);
		clearRows(delta.clearedRows);
		options.runtime.applyNormalizedVisibilityDelta(delta);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		unregisterBackpressure?.();
		for (const card of cardsBySlot.values()) {
			card.unregister();
			card.state.snapshot = undefined;
		}
		cardsBySlot.clear();
		statesBySlot.clear();
	}

	return {
		syncCards,
		applyNormalizedVisibilityDelta,
		getSlotState: (slotId) => statesBySlot.get(slotId),
		dispose,
	};
}
