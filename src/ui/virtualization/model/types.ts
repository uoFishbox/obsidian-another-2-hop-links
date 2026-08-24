import type { MutableRowRange, RowRange } from "./rowRange";
import type { VirtualRowLayoutMetrics } from "./layoutMetrics";

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

export interface VirtualListRevision {
	readonly content: unknown;
	readonly layout: unknown;
}

export interface VirtualRowModel<TCell> {
	revision: VirtualListRevision;
	rowCount: number;
	totalHeight: number;
	layout: VirtualRowLayoutMetrics;

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
