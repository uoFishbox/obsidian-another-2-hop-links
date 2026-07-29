import type {
	TwoHopDocument,
	TwoHopDocumentItem,
} from "features/two-hop/ui/twoHopDocument";
import type { TwoHopVirtualListSection } from "features/two-hop/ui/twoHopVirtualListModel";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

export interface TwoHopCardModelPrewarmer {
	/**
	 * Replaces pending work with a fresh traversal of the visible document.
	 */
	schedule(
		document: TwoHopDocument,
		resolveItem: (
			item: TwoHopDocumentItem,
			section: TwoHopVirtualListSection,
		) => void,
	): void;
	cancel(): void;
	dispose(): void;
}

const PREWARM_TASK_KEY = "two-hop-card-model-prewarm";
const PREWARM_CHUNK_BUDGET_MS = 1.5;
const PREWARM_CHUNK_MAX_WORK_UNITS = 32;

/** Creates bounded, replaceable idle work for warming two-hop card models. */
export function createTwoHopCardModelPrewarmer(params: {
	readonly frameCoordinator?: VirtualFrameCoordinator;
	readonly readNow?: () => number;
}): TwoHopCardModelPrewarmer {
	const frameCoordinator = params.frameCoordinator;
	const readNow =
		params.readNow ??
		(() =>
			typeof globalThis.performance?.now === "function"
				? globalThis.performance.now()
				: Date.now());
	let generation = 0;
	let disposed = false;

	return {
		schedule(document, resolveItem): void {
			generation += 1;
			frameCoordinator?.cancel("idle", PREWARM_TASK_KEY);
			if (disposed || !frameCoordinator) return;

			const scheduledGeneration = generation;
			let sectionIndex = 0;
			let itemIndex = 0;

			const runChunk = (): void => {
				if (disposed || generation !== scheduledGeneration) return;

				const deadline = readNow() + PREWARM_CHUNK_BUDGET_MS;
				let workUnits = 0;

				while (
					sectionIndex < document.sections.length &&
					workUnits < PREWARM_CHUNK_MAX_WORK_UNITS &&
					(workUnits === 0 || readNow() < deadline)
				) {
					const section = document.sections[sectionIndex];
					workUnits += 1;
					if (itemIndex >= section.visibleItemCount) {
						sectionIndex += 1;
						itemIndex = 0;
						continue;
					}

					const item = section.getItem(itemIndex);
					itemIndex += 1;
					if (item) resolveItem(item, section.header.section);
					if (itemIndex >= section.visibleItemCount) {
						sectionIndex += 1;
						itemIndex = 0;
					}
				}

				if (
					!disposed &&
					generation === scheduledGeneration &&
					sectionIndex < document.sections.length
				) {
					frameCoordinator.schedule("idle", PREWARM_TASK_KEY, runChunk);
				}
			};

			frameCoordinator.schedule("idle", PREWARM_TASK_KEY, runChunk);
		},
		cancel(): void {
			generation += 1;
			frameCoordinator?.cancel("idle", PREWARM_TASK_KEY);
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			generation += 1;
			frameCoordinator?.cancel("idle", PREWARM_TASK_KEY);
		},
	};
}
