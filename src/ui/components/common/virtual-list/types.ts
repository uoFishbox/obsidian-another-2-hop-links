import type { RowRange } from "./rowRange";
import type { RowNumberLookup } from "./layout/viewPlanRowTypes";
import type { VirtualRowLayoutMetrics } from "./layoutMetrics";
import type { RenderBodyKey, RenderRevision } from "./renderRevision";
import type { RowKey } from "./rowKey";

export type VirtualizedItemVisibility = "visible" | "mounted";

export interface VirtualizedItemVisibilityState {
	visibility: VirtualizedItemVisibility | undefined;
}

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & {
	readonly [brand]: TBrand;
};

export type LogicalCellKey = Brand<string, "LogicalCellKey">;
export type RenderSlotKey = Brand<number, "RenderSlotKey">;
export type SourceKey = Brand<string, "SourceKey">;
export const logicalCellKey = (value: string): LogicalCellKey =>
	value as LogicalCellKey;

export const renderSlotKey = (value: number): RenderSlotKey => value as RenderSlotKey;

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
	readonly keyResolver: unknown;
	readonly pagination: unknown;
	readonly measurement: unknown;
	readonly previewPolicy: unknown;
}

export type VirtualRowModelRevision =
	| VirtualListRevision
	| { readonly kind: "opaque"; readonly token: unknown };

export interface VirtualRowModel<TCell> {
	revision: VirtualRowModelRevision;
	rowCount: number;
	readonly rowCellCountByRow?: Uint16Array | RowNumberLookup;
	totalHeight: number;
	layout: VirtualRowLayoutMetrics;

	getRow(rowIndex: number): VirtualRow<TCell> | null;
	getRowCellCount?: (rowIndex: number) => number;
	getRowTop?: (rowIndex: number) => number;
	getRowEnd?: (rowIndex: number) => number;

	findVisibleRange(params: {
		scrollTop: number;
		viewportHeight: number;
		overscanPx: number;
	}): RowRange;
	findVisibleRanges?(params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangesFromMounted?(params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;

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
	readonly renderSlotKey: RenderSlotKey;
	readonly renderSlotIndex: number;
	readonly rowIndex: number;
	readonly columnIndex?: number;
	readonly visibility?: VirtualizedItemVisibility;
	readonly cellMetadataKey?: unknown;
	readonly renderBodyKey?: RenderBodyKey;
	readonly cellSlotKey?: number;
}

export interface VirtualGridDataSource<T> {
	readonly count: number;
	readonly revision: unknown;
	readonly keyRevision: unknown;
	getItem(index: number): T | undefined;
	getKey(item: T, index: number): string;
	getItemRenderRevision?(item: T, index: number): RenderRevision | undefined;
}
