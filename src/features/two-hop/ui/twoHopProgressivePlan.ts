import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import {
	resolveSectionIndexForRow,
	resolveTwoHopRowTop,
	type TwoHopGeometry,
} from "features/two-hop/ui/viewport/twoHopGeometry";

export const TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK = 16;
export const TWO_HOP_PROGRESSIVE_INITIAL_CHUNK_COUNT = 2;

interface ProgressiveCellBase {
	readonly logicalKey: string;
	readonly section: TwoHopSectionModel;
	readonly rowIndex: number;
	readonly columnIndex: number;
}

export type TwoHopProgressiveCell =
	| (ProgressiveCellBase & { readonly kind: "header" })
	| (ProgressiveCellBase & {
			readonly kind: "item";
			readonly itemIndex: number;
			readonly item: TwoHopItemModel;
	  })
	| (ProgressiveCellBase & { readonly kind: "load-more" });

export interface TwoHopProgressiveRow {
	readonly rowIndex: number;
	readonly top: number;
	readonly cells: readonly TwoHopProgressiveCell[];
}

export interface TwoHopProgressiveChunk {
	readonly chunkIndex: number;
	readonly rowStart: number;
	readonly rowEnd: number;
	readonly height: number;
	readonly rows: readonly TwoHopProgressiveRow[];
}

export interface TwoHopProgressivePlan {
	readonly sections: readonly TwoHopSectionModel[];
	readonly geometry: TwoHopGeometry;
	readonly mountedRowEnd: number;
	readonly totalRowCount: number;
	readonly hasMoreRows: boolean;
	readonly chunks: readonly TwoHopProgressiveChunk[];
}

export function resolveMountedProgressiveRow(
	plan: TwoHopProgressivePlan,
	rowIndex: number,
): TwoHopProgressiveRow | null {
	if (rowIndex < 0 || rowIndex >= plan.mountedRowEnd) return null;
	const chunkIndex = Math.floor(rowIndex / TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK);
	const chunk = plan.chunks[chunkIndex];
	if (!chunk) return null;
	const row = chunk.rows[rowIndex - chunk.rowStart];
	return row?.rowIndex === rowIndex ? row : null;
}

export function resolveInitialProgressiveMountedRowEnd(rowCount: number): number {
	return Math.min(
		Math.max(0, Math.floor(rowCount)),
		TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK * TWO_HOP_PROGRESSIVE_INITIAL_CHUNK_COUNT,
	);
}

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

export function compileTwoHopProgressivePlan(
	sections: readonly TwoHopSectionModel[],
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
		chunks.push(buildProgressiveChunk(sections, geometry, rowStart, rowEnd));
	}
	return createPlan(sections, geometry, normalizedMountedEnd, chunks);
}

export function appendTwoHopProgressivePlan(
	sections: readonly TwoHopSectionModel[],
	geometry: TwoHopGeometry,
	previous: TwoHopProgressivePlan,
	mountedRowEnd: number,
): TwoHopProgressivePlan {
	const normalizedMountedEnd = Math.min(
		geometry.rowCount,
		Math.max(0, Math.floor(mountedRowEnd)),
	);
	if (
		previous.sections !== sections ||
		previous.geometry !== geometry ||
		previous.mountedRowEnd > normalizedMountedEnd ||
		(previous.mountedRowEnd < geometry.rowCount &&
			previous.mountedRowEnd % TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK !== 0)
	) {
		return compileTwoHopProgressivePlan(sections, geometry, normalizedMountedEnd);
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
		chunks.push(buildProgressiveChunk(sections, geometry, rowStart, rowEnd));
	}
	return createPlan(sections, geometry, normalizedMountedEnd, chunks);
}

function createPlan(
	sections: readonly TwoHopSectionModel[],
	geometry: TwoHopGeometry,
	mountedRowEnd: number,
	chunks: readonly TwoHopProgressiveChunk[],
): TwoHopProgressivePlan {
	return Object.freeze({
		sections,
		geometry,
		mountedRowEnd,
		totalRowCount: geometry.rowCount,
		hasMoreRows: mountedRowEnd < geometry.rowCount,
		chunks: Object.freeze(chunks),
	});
}

/** Materializes one append-only chunk directly from section arrays. */
export function buildProgressiveChunk(
	sections: readonly TwoHopSectionModel[],
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

	for (let rowIndex = rowStart; rowIndex < rowEnd; rowIndex += 1) {
		const sectionIndex = resolveSectionIndexForRow(geometry, rowIndex);
		const section = sections[sectionIndex];
		if (!section) continue;
		const rowInSection = rowIndex - geometry.firstRowBySection[sectionIndex];
		const rowTop =
			geometry.topBySection[sectionIndex] + rowInSection * geometry.rowStride;
		const cells: TwoHopProgressiveCell[] = [];

		for (let columnIndex = 0; columnIndex < geometry.columns; columnIndex += 1) {
			const cellIndex = rowInSection * geometry.columns + columnIndex;
			const cell = resolveTwoHopProgressiveCell(
				section,
				rowIndex,
				columnIndex,
				cellIndex,
			);
			if (cell) cells.push(cell);
		}

		rows.push(
			Object.freeze({
				rowIndex,
				top: rowTop - chunkTop,
				cells: Object.freeze(cells),
			}),
		);
	}

	return Object.freeze({
		chunkIndex: Math.floor(rowStart / TWO_HOP_PROGRESSIVE_ROWS_PER_CHUNK),
		rowStart,
		rowEnd,
		height: Math.max(0, chunkBottom - chunkTop),
		rows: Object.freeze(rows),
	});
}

/** Resolves one logical cell without materializing its containing row or chunk. */
export function resolveTwoHopProgressiveCell(
	section: TwoHopSectionModel,
	rowIndex: number,
	columnIndex: number,
	cellIndex: number,
): TwoHopProgressiveCell | null {
	if (cellIndex === 0) {
		return Object.freeze({
			section,
			rowIndex,
			columnIndex,
			kind: "header",
			logicalKey: section.header.logicalKey,
		});
	}

	const itemIndex = cellIndex - 1;
	if (itemIndex < section.items.length) {
		const item = section.items[itemIndex];
		if (!item) return null;
		return Object.freeze({
			section,
			rowIndex,
			columnIndex,
			kind: "item",
			logicalKey: `item:${section.id}:${item.key}`,
			itemIndex,
			item,
		});
	}

	if (
		itemIndex === section.items.length &&
		section.items.length < section.totalCount
	) {
		return Object.freeze({
			section,
			rowIndex,
			columnIndex,
			kind: "load-more",
			logicalKey: `load-more:${section.id}`,
		});
	}
	return null;
}
