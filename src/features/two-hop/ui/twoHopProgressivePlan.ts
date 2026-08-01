import type {
	TwoHopDocument,
	TwoHopDocumentItem,
	TwoHopDocumentSection,
} from "features/two-hop/ui/twoHopDocument";
import {
	createTwoHopResolvedCellBuffer,
	createTwoHopResolvedRowBuffer,
	resolveTwoHopCellInRowInto,
	resolveTwoHopRowInto,
	resolveTwoHopRowTop,
	type TwoHopGeometry,
} from "features/two-hop/ui/viewport/twoHopGeometry";

export const TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK = 16;
export const TWO_HOP_PROGRESSIVE_INITIAL_CHUNK_COUNT = 2;
export const TWO_HOP_PROGRESSIVE_PRELOAD_CHUNK_COUNT = 1;

interface ProgressiveCellBase {
	readonly logicalKey: string;
	readonly section: TwoHopDocumentSection;
	readonly rowIndex: number;
	readonly columnIndex: number;
}

export type TwoHopProgressiveCell =
	| (ProgressiveCellBase & { readonly kind: "header" })
	| (ProgressiveCellBase & {
			readonly kind: "item";
			readonly itemIndex: number;
			readonly item: TwoHopDocumentItem;
	  })
	| (ProgressiveCellBase & { readonly kind: "load-more" });

export interface TwoHopProgressiveRow {
	readonly key: string;
	readonly rowIndex: number;
	readonly top: number;
	readonly cells: readonly TwoHopProgressiveCell[];
}

export interface TwoHopProgressiveChunk {
	readonly key: string;
	readonly chunkIndex: number;
	readonly rowStart: number;
	readonly rowEnd: number;
	readonly height: number;
	readonly rows: readonly TwoHopProgressiveRow[];
}

export interface TwoHopProgressivePlan {
	readonly mountedRowEnd: number;
	readonly totalRowCount: number;
	readonly hasMoreRows: boolean;
	readonly chunks: readonly TwoHopProgressiveChunk[];
}

interface ProgressivePlanSource {
	readonly document: TwoHopDocument;
	readonly geometry: TwoHopGeometry;
}

const sourceByPlan = new WeakMap<TwoHopProgressivePlan, ProgressivePlanSource>();

/** Returns the append-only prefix mounted when a progressive document opens. */
export function resolveInitialProgressiveMountedRowEnd(rowCount: number): number {
	return Math.min(
		Math.max(0, Math.floor(rowCount)),
		TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * TWO_HOP_PROGRESSIVE_INITIAL_CHUNK_COUNT,
	);
}

/** Appends at most one chunk to an existing mounted prefix. */
export function resolveNextProgressiveMountedRowEnd(
	mountedRowEnd: number,
	rowCount: number,
): number {
	const normalizedRowCount = Math.max(0, Math.floor(rowCount));
	const normalizedMountedEnd = Math.min(
		normalizedRowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	return Math.min(
		normalizedRowCount,
		normalizedMountedEnd + TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
	);
}

/** Compiles only the currently mounted prefix into fixed-height chunk shells. */
export function compileTwoHopProgressivePlan(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	mountedRowEnd: number,
): TwoHopProgressivePlan {
	const normalizedMountedEnd = Math.min(
		geometry.rowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	const chunks: TwoHopProgressiveChunk[] = [];

	for (
		let rowStart = 0;
		rowStart < normalizedMountedEnd;
		rowStart += TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK
	) {
		const rowEnd = Math.min(
			normalizedMountedEnd,
			rowStart + TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
		);
		chunks.push(compileChunk(document, geometry, rowStart, rowEnd));
	}

	return createPlan(document, geometry, normalizedMountedEnd, chunks);
}

/** Appends newly mounted chunks while preserving every existing publication. */
export function appendTwoHopProgressivePlan(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	previous: TwoHopProgressivePlan,
	mountedRowEnd: number,
): TwoHopProgressivePlan {
	const normalizedMountedEnd = Math.min(
		geometry.rowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	const source = sourceByPlan.get(previous);
	if (
		source?.document !== document ||
		source.geometry !== geometry ||
		previous.totalRowCount !== geometry.rowCount ||
		previous.mountedRowEnd > normalizedMountedEnd ||
		(previous.mountedRowEnd < geometry.rowCount &&
			previous.mountedRowEnd % TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK !== 0)
	) {
		return compileTwoHopProgressivePlan(document, geometry, normalizedMountedEnd);
	}
	if (previous.mountedRowEnd === normalizedMountedEnd) return previous;

	const chunks = [...previous.chunks];
	for (
		let rowStart = previous.mountedRowEnd;
		rowStart < normalizedMountedEnd;
		rowStart += TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK
	) {
		const rowEnd = Math.min(
			normalizedMountedEnd,
			rowStart + TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
		);
		chunks.push(compileChunk(document, geometry, rowStart, rowEnd));
	}

	return createPlan(document, geometry, normalizedMountedEnd, chunks);
}

function createPlan(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	mountedRowEnd: number,
	chunks: TwoHopProgressiveChunk[],
): TwoHopProgressivePlan {
	const plan: TwoHopProgressivePlan = Object.freeze({
		mountedRowEnd,
		totalRowCount: geometry.rowCount,
		hasMoreRows: mountedRowEnd < geometry.rowCount,
		chunks: Object.freeze(chunks),
	});
	sourceByPlan.set(plan, { document, geometry });
	return plan;
}

function compileChunk(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	rowStart: number,
	rowEnd: number,
): TwoHopProgressiveChunk {
	const chunkTop = resolveTwoHopRowTop(geometry, rowStart);
	const chunkBottom =
		rowEnd < geometry.rowCount
			? resolveTwoHopRowTop(geometry, rowEnd)
			: geometry.totalHeight;
	const rows: TwoHopProgressiveRow[] = [];
	const rowBuffer = createTwoHopResolvedRowBuffer();
	const cellBuffer = createTwoHopResolvedCellBuffer();

	for (let rowIndex = rowStart; rowIndex < rowEnd; rowIndex += 1) {
		if (!resolveTwoHopRowInto(geometry, rowIndex, rowBuffer)) continue;
		const section = document.sections[rowBuffer.sectionIndex];
		if (!section) continue;
		const cells: TwoHopProgressiveCell[] = [];

		for (let columnIndex = 0; columnIndex < geometry.columns; columnIndex += 1) {
			const resolved = resolveTwoHopCellInRowInto(
				document,
				geometry,
				rowBuffer,
				columnIndex,
				cellBuffer,
			);
			if (!resolved) continue;

			if (resolved.kind === "item") {
				cells.push(
					Object.freeze({
						kind: "item",
						logicalKey: resolved.logicalKey,
						section,
						rowIndex,
						columnIndex,
						itemIndex: resolved.itemIndex,
						item: resolved.item,
					}),
				);
				continue;
			}

			cells.push(
				Object.freeze({
					kind: resolved.kind,
					logicalKey: resolved.logicalKey,
					section,
					rowIndex,
					columnIndex,
				}),
			);
		}

		rows.push(
			Object.freeze({
				key: `progressive-row:${rowIndex}`,
				rowIndex,
				top: rowBuffer.top - chunkTop,
				cells: Object.freeze(cells),
			}),
		);
	}

	return Object.freeze({
		key: `progressive-chunk:${Math.floor(
			rowStart / TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK,
		)}`,
		chunkIndex: Math.floor(rowStart / TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK),
		rowStart,
		rowEnd,
		height: Math.max(0, chunkBottom - chunkTop),
		rows: Object.freeze(rows),
	});
}
