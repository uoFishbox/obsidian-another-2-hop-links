import type { RowRange } from "./rowRange";
import type { VirtualRowLayoutMetrics } from "./layoutMetrics";

export interface RowNumberLookup {
	readonly length: number;
	readonly [index: number]: number;
	[Symbol.iterator](): IterableIterator<number>;
}

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & {
	readonly [brand]: TBrand;
};

export type LogicalCellKey = Brand<string, "LogicalCellKey">;
export type SourceKey = Brand<string, "SourceKey">;
export type RowKey = number;
export const logicalCellKey = (value: string): LogicalCellKey =>
	value as LogicalCellKey;

export const sourceKey = (value: string): SourceKey => value as SourceKey;

export interface VirtualRow<TCell> {
	key: RowKey;
	index: number;
	top: number;
	height: number;
	bottomSpacing: number;
	cellCount: number;
	getCell(columnIndex: number): TCell | null;
}

export interface VirtualListRevision {
	readonly content: unknown;
	readonly layout: unknown;
}

export interface VirtualRowModel<TCell> {
	revision: VirtualListRevision;
	rowCount: number;
	readonly rowCellCountByRow?: Uint16Array | RowNumberLookup;
	totalHeight: number;
	layout: VirtualRowLayoutMetrics;

	getRow(rowIndex: number): VirtualRow<TCell> | null;
	getRowCellCount?: (rowIndex: number) => number;
	getRowTop?: (rowIndex: number) => number;
	getRowEnd?: (rowIndex: number) => number;

	findVisibleRangeInto(
		out: RowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRangesInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			mounted?: RowRange;
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
}

export type VirtualNavigationDirection = "up" | "down" | "left" | "right";

export interface VirtualNavigationTarget {
	key: string;
	rowTop: number;
}

export interface VirtualRanges {
	mounted: RowRange;
	previewVisible: RowRange;
}

export interface MountedVirtualCell {
	readonly key: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly rowIndex: number;
	readonly columnIndex?: number;
}
