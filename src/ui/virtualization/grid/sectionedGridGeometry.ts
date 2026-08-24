export interface SectionedGridGeometryInput {
	readonly sectionCellCounts: readonly number[];
	readonly columns: number;
	readonly rowHeight: number;
	readonly gap: number;
	/** Space after the last row of every non-empty section. */
	readonly sectionMarginBottom: number;
}

export interface SectionedGridRowPosition {
	readonly sectionIndex: number;
	readonly rowInSection: number;
	readonly firstCellIndexInSection: number;
	readonly cellCount: number;
	readonly top: number;
}

export interface SectionedGridCellPosition {
	readonly rowIndex: number;
	readonly columnIndex: number;
}

/**
 * Immutable row geometry for grids whose sections always start on a new row.
 * Empty sections occupy neither rows nor section spacing.
 */
export interface SectionedGridGeometry {
	readonly columns: number;
	readonly rowHeight: number;
	readonly gap: number;
	readonly rowStride: number;
	readonly sectionMarginBottom: number;
	readonly rowCount: number;
	readonly totalHeight: number;
	resolveRow(rowIndex: number): SectionedGridRowPosition | null;
	resolveRowTop(rowIndex: number): number | null;
	resolveCellPosition(
		sectionIndex: number,
		cellIndex: number,
	): SectionedGridCellPosition | null;
	resolveFirstRowEndingAfter(offset: number): number;
	resolveFirstRowStartingAtOrAfter(offset: number): number;
}

interface RenderedSectionGeometry {
	readonly sectionIndex: number;
	readonly cellCount: number;
	readonly firstRow: number;
	readonly rowCount: number;
	readonly top: number;
}

/** Creates section-aware grid geometry without depending on logical cell data. */
export function createSectionedGridGeometry(
	input: SectionedGridGeometryInput,
): SectionedGridGeometry {
	const columns = normalizePositiveInteger(input.columns);
	const rowHeight = normalizeNonNegativeNumber(input.rowHeight);
	const gap = normalizeNonNegativeNumber(input.gap);
	const sectionMarginBottom = normalizeNonNegativeNumber(input.sectionMarginBottom);
	const rowStride = rowHeight + gap;
	const renderedSections: RenderedSectionGeometry[] = [];
	const sectionCellCounts = input.sectionCellCounts.map(normalizeNonNegativeInteger);
	const sectionFirstRows = new Array<number>(input.sectionCellCounts.length);
	let rowCount = 0;
	let totalHeight = 0;

	for (
		let sectionIndex = 0;
		sectionIndex < input.sectionCellCounts.length;
		sectionIndex += 1
	) {
		const cellCount = sectionCellCounts[sectionIndex] ?? 0;
		const rowsInSection = cellCount > 0 ? Math.ceil(cellCount / columns) : 0;
		sectionFirstRows[sectionIndex] = rowCount;
		if (rowsInSection === 0) continue;

		renderedSections.push({
			sectionIndex,
			cellCount,
			firstRow: rowCount,
			rowCount: rowsInSection,
			top: totalHeight,
		});
		rowCount += rowsInSection;
		totalHeight +=
			rowsInSection * rowHeight + (rowsInSection - 1) * gap + sectionMarginBottom;
	}

	function resolveRenderedSectionForRow(
		rowIndex: number,
	): RenderedSectionGeometry | null {
		if (rowIndex < 0 || rowIndex >= rowCount) return null;
		let low = 0;
		let high = renderedSections.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (renderedSections[middle]!.firstRow <= rowIndex) low = middle + 1;
			else high = middle;
		}
		return renderedSections[low - 1] ?? null;
	}

	function resolveRow(rowIndex: number): SectionedGridRowPosition | null {
		const section = resolveRenderedSectionForRow(rowIndex);
		if (!section) return null;
		const rowInSection = rowIndex - section.firstRow;
		const firstCellIndexInSection = rowInSection * columns;
		return {
			sectionIndex: section.sectionIndex,
			rowInSection,
			firstCellIndexInSection,
			cellCount: Math.min(columns, section.cellCount - firstCellIndexInSection),
			top: section.top + rowInSection * rowStride,
		};
	}

	function resolveFirstRowEndingAfter(offset: number): number {
		const pixelTarget = offset - rowHeight;
		let low = 0;
		let high = renderedSections.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			const section = renderedSections[middle]!;
			const lastRowTop = section.top + (section.rowCount - 1) * rowStride;
			if (lastRowTop <= pixelTarget) low = middle + 1;
			else high = middle;
		}
		const section = renderedSections[low];
		if (!section) return rowCount;
		if (rowStride <= 0) return section.firstRow;
		const rowInSection = Math.min(
			section.rowCount - 1,
			Math.max(0, Math.floor((pixelTarget - section.top) / rowStride) + 1),
		);
		return section.firstRow + rowInSection;
	}

	function resolveFirstRowStartingAtOrAfter(offset: number): number {
		let low = 0;
		let high = renderedSections.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			const section = renderedSections[middle]!;
			const lastRowTop = section.top + (section.rowCount - 1) * rowStride;
			if (lastRowTop < offset) low = middle + 1;
			else high = middle;
		}
		const section = renderedSections[low];
		if (!section) return rowCount;
		if (rowStride <= 0) return section.firstRow;
		const rowInSection = Math.min(
			section.rowCount - 1,
			Math.max(0, Math.ceil((offset - section.top) / rowStride)),
		);
		return section.firstRow + rowInSection;
	}

	return {
		columns,
		rowHeight,
		gap,
		rowStride,
		sectionMarginBottom,
		rowCount,
		totalHeight,
		resolveRow,
		resolveRowTop(rowIndex) {
			return resolveRow(rowIndex)?.top ?? null;
		},
		resolveCellPosition(sectionIndex, cellIndex) {
			const firstRow = sectionFirstRows[sectionIndex];
			const requestedCellCount = sectionCellCounts[sectionIndex] ?? 0;
			if (
				firstRow === undefined ||
				requestedCellCount === 0 ||
				cellIndex < 0 ||
				cellIndex >= requestedCellCount
			) {
				return null;
			}
			return {
				rowIndex: firstRow + Math.floor(cellIndex / columns),
				columnIndex: cellIndex % columns,
			};
		},
		resolveFirstRowEndingAfter,
		resolveFirstRowStartingAtOrAfter,
	};
}

function normalizePositiveInteger(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.floor(value));
}

function normalizeNonNegativeNumber(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, value);
}
