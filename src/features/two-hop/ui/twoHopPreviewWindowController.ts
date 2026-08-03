import type { TwoHopRowRange } from "features/two-hop/ui/viewport/twoHopGeometry";

type PreviewRowConsumer = (resident: boolean) => void;

export interface TwoHopPreviewWindowController {
	readonly activeRange: TwoHopRowRange;
	readonly residentRange: TwoHopRowRange;
	registerRow(rowIndex: number, consumer: PreviewRowConsumer): () => void;
	apply(activeRange: TwoHopRowRange, residentRange: TwoHopRowRange): void;
	clear(): void;
	dispose(): void;
}

/** Owns preview active/resident ranges and row host publication. */
export function createTwoHopPreviewWindowController(
	onChanged: (activeChanged: boolean, residentChanged: boolean) => void,
): TwoHopPreviewWindowController {
	const consumers = new Map<number, PreviewRowConsumer>();
	const activeRange: TwoHopRowRange = { start: 0, end: 0 };
	const residentRange: TwoHopRowRange = { start: 0, end: 0 };

	function registerRow(rowIndex: number, consumer: PreviewRowConsumer): () => void {
		consumers.set(rowIndex, consumer);
		consumer(isRowInRange(rowIndex, residentRange));
		return () => {
			if (consumers.get(rowIndex) === consumer) consumers.delete(rowIndex);
			consumer(false);
		};
	}

	function apply(
		nextActiveRange: TwoHopRowRange,
		nextResidentRange: TwoHopRowRange,
	): void {
		const activeChanged = !isSameRange(activeRange, nextActiveRange);
		const residentChanged = !isSameRange(residentRange, nextResidentRange);
		if (!activeChanged && !residentChanged) return;

		if (residentChanged) {
			for (
				let rowIndex = residentRange.start;
				rowIndex < residentRange.end;
				rowIndex += 1
			) {
				if (isRowInRange(rowIndex, nextResidentRange)) continue;
				consumers.get(rowIndex)?.(false);
			}

			for (
				let rowIndex = nextResidentRange.start;
				rowIndex < nextResidentRange.end;
				rowIndex += 1
			) {
				if (isRowInRange(rowIndex, residentRange)) continue;
				consumers.get(rowIndex)?.(true);
			}
		}

		copyRange(activeRange, nextActiveRange);
		copyRange(residentRange, nextResidentRange);
		onChanged(activeChanged, residentChanged);
	}

	function clear(): void {
		apply(EMPTY_RANGE, EMPTY_RANGE);
	}

	function dispose(): void {
		for (const consumer of consumers.values()) consumer(false);
		consumers.clear();
		copyRange(activeRange, EMPTY_RANGE);
		copyRange(residentRange, EMPTY_RANGE);
	}

	return { activeRange, residentRange, registerRow, apply, clear, dispose };
}

const EMPTY_RANGE: TwoHopRowRange = Object.freeze({ start: 0, end: 0 });

function isSameRange(left: TwoHopRowRange, right: TwoHopRowRange): boolean {
	return left.start === right.start && left.end === right.end;
}

function isRowInRange(rowIndex: number, range: TwoHopRowRange): boolean {
	return rowIndex >= range.start && rowIndex < range.end;
}

function copyRange(target: TwoHopRowRange, source: TwoHopRowRange): void {
	target.start = source.start;
	target.end = source.end;
}
