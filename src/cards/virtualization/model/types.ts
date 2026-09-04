export interface RowRange {
	readonly start: number;
	readonly end: number;
}

/** Caller-owned scratch range used by row-model writers. */
export interface MutableRowRange {
	start: number;
	end: number;
}

export interface VirtualRowLayoutMetrics {
	containerWidth: number;
	columns: number;
	cellWidth: number;
	gap: number;
	rowHeight: number;
	contentHeight: number;
}

export interface FlatGridLayoutMetrics extends VirtualRowLayoutMetrics {
	rowCount: number;
	rowStride: number;
}

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & {
	readonly [brand]: TBrand;
};

export type LogicalCellKey = Brand<string, "LogicalCellKey">;
export type SourceKey = Brand<string, "SourceKey">;
export const logicalCellKey = (value: string): LogicalCellKey =>
	value as LogicalCellKey;

export const sourceKey = (value: string): SourceKey => value as SourceKey;

export interface VirtualRow<TCell> {
	top: number;
	cellCount: number;
	getCell(columnIndex: number): TCell | null;
}

/**
 * Immutable compiled row model. Reuse the same instance while content and
 * layout are unchanged; publish a new instance when either changes.
 */
export interface VirtualRowModel<TCell> {
	readonly rowCount: number;
	readonly totalHeight: number;
	readonly layout: VirtualRowLayoutMetrics;

	getRow(rowIndex: number): VirtualRow<TCell> | null;

	findVisibleRangeInto(
		out: MutableRowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRangesInto(
		out: MutableVirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;

	resolveNavigationTarget?: (
		currentKey: string,
		direction: VirtualNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualNavigationTarget | null;
	resolveSequentialNavigationTarget?: (
		currentKey: string,
		direction: VirtualSequentialNavigationDirection,
		currentPosition: {
			rowIndex: number;
			columnIndex: number;
		},
	) => VirtualSequentialNavigationTarget | null;
}

export type VirtualNavigationDirection = "up" | "down" | "left" | "right";
export type VirtualSequentialNavigationDirection = "forward" | "backward";

export interface VirtualNavigationTarget {
	key: string;
	rowTop: number;
}

export interface VirtualSequentialNavigationTarget extends VirtualNavigationTarget {
	rowIndex: number;
	columnIndex: number;
}

export interface VirtualRanges {
	readonly mounted: RowRange;
	readonly previewVisible: RowRange;
}

/** Caller-owned scratch ranges used by row-model writers. */
export interface MutableVirtualRanges {
	mounted: MutableRowRange;
	previewVisible: MutableRowRange;
}

export interface MountedVirtualCell {
	readonly key: LogicalCellKey;
	readonly physicalCellSlot: number;
	readonly rowIndex: number;
	readonly columnIndex?: number;
}
