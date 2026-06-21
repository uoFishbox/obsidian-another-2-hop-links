import {
	createArrayVirtualGridDataSource,
	createFlatLogicalCellSource,
	type FlatLogicalCellSource,
} from "../flatLogicalCellSource";
import type { VirtualGridDataSource } from "../types";
import type { FlatGridLayoutMetrics } from "../layoutMetrics";
import type { RenderRevision } from "../renderRevision";
import {
	createFlatLinkRowModel,
	type FlatLinkRowModel,
} from "./flatLinkRowModel";
import { resolveVirtualListKeyRevision } from "./virtualListKeyRevision";

export interface FlatListContentRevision {
	readonly data: unknown;
	readonly key: unknown;
	readonly visibleCount: number;
	readonly hasHeader: boolean;
	readonly showLoadMore: boolean;
	readonly sectionId?: string;
}

export type FlatGridLayoutMemoKey = readonly [
	columns: number,
	cellWidth: number,
	rowHeight: number,
	gap: number,
	rowCount: number,
];

interface LogicalCellSourceMemoEntry<T> {
	readonly revision: FlatListContentRevision;
	readonly source: FlatLogicalCellSource<T>;
}

interface FlatLinkRowModelMemoEntry<T> {
	readonly cellSourceRevision: unknown;
	readonly layoutMemoKey: FlatGridLayoutMemoKey;
	readonly rowModel: FlatLinkRowModel<T>;
}

export function createFlatListContentRevision(params: {
	dataRevision: unknown;
	keyRevision: unknown;
	visibleCount: number;
	hasHeader: boolean;
	showLoadMore: boolean;
	sectionId?: string;
}): FlatListContentRevision {
	return {
		data: params.dataRevision,
		key: params.keyRevision,
		visibleCount: params.visibleCount,
		hasHeader: params.hasHeader,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	};
}

export function hasSameFlatListContentRevision(
	current: FlatListContentRevision,
	next: FlatListContentRevision,
): boolean {
	return (
		Object.is(current.data, next.data) &&
		Object.is(current.key, next.key) &&
		current.visibleCount === next.visibleCount &&
		current.hasHeader === next.hasHeader &&
		current.showLoadMore === next.showLoadMore &&
		current.sectionId === next.sectionId
	);
}

export function createFlatGridLayoutMemoKey(
	layout: FlatGridLayoutMetrics,
): FlatGridLayoutMemoKey {
	return [
		layout.columns,
		layout.cellWidth,
		layout.rowHeight,
		layout.gap,
		layout.rowCount,
	];
}

export function hasSameFlatGridLayoutMemoKey(
	current: FlatGridLayoutMemoKey,
	next: FlatGridLayoutMemoKey,
): boolean {
	return current.every((value, index) => Object.is(value, next[index]));
}

/**
 * Keeps one logical-source memo and one row-model memo per list instance.
 * Callers mutating an items array in place must change itemsRevision. Callers
 * changing key behavior without replacing getKey must change keyRevision.
 */
export function createFlatVirtualGridRuntimeModel<T>() {
	let logicalCellSourceMemo: LogicalCellSourceMemoEntry<T> | null = null;
	let rowModelMemo: FlatLinkRowModelMemoEntry<T> | null = null;

	return {
		createDataSource(params: {
			items: readonly T[];
			getKey: (item: T, index: number) => string;
			itemsRevision?: unknown;
			keyRevision?: unknown;
			itemRenderRevisionToken?: RenderRevision;
			getItemRenderRevision?: (
				item: T,
				index: number,
			) => RenderRevision | undefined;
		}): VirtualGridDataSource<T> {
			const keyRevision = resolveVirtualListKeyRevision({
				explicitRevision: params.keyRevision,
				resolver: params.getKey,
			});
			return createArrayVirtualGridDataSource({
				items: params.items,
				getKey: params.getKey,
				revision: {
					data: params.itemsRevision ?? params.items,
					itemRenderRevisionResolver:
						params.itemRenderRevisionToken ??
						params.getItemRenderRevision,
				},
				keyRevision,
				getItemRenderRevision: params.getItemRenderRevision,
			});
		},

		resolveLogicalCellSource(params: {
			dataSource: VirtualGridDataSource<T>;
			visibleCount: number;
			hasHeader: boolean;
			showLoadMore: boolean;
			sectionId?: string;
		}): FlatLogicalCellSource<T> {
			const revision = createFlatListContentRevision({
				dataRevision: params.dataSource.revision,
				keyRevision: params.dataSource.keyRevision,
				visibleCount: params.visibleCount,
				hasHeader: params.hasHeader,
				showLoadMore: params.showLoadMore,
				sectionId: params.sectionId,
			});
			const memo = logicalCellSourceMemo;
			if (
				memo &&
				hasSameFlatListContentRevision(memo.revision, revision)
			) {
				return memo.source;
			}

			const source = createFlatLogicalCellSource({
				header: params.hasHeader,
				dataSource: params.dataSource,
				visibleCount: params.visibleCount,
				showLoadMore: params.showLoadMore,
				sectionId: params.sectionId,
				revision,
			});
			logicalCellSourceMemo = {
				revision,
				source,
			};
			return source;
		},

		resolveRowModel(params: {
			cellSource: FlatLogicalCellSource<T>;
			layout: FlatGridLayoutMetrics;
		}): FlatLinkRowModel<T> {
			const layoutMemoKey = createFlatGridLayoutMemoKey(params.layout);
			const memo = rowModelMemo;
			if (
				memo &&
				Object.is(memo.cellSourceRevision, params.cellSource.revision) &&
				hasSameFlatGridLayoutMemoKey(
					memo.layoutMemoKey,
					layoutMemoKey,
				)
			) {
				return memo.rowModel;
			}

			const rowModel = createFlatLinkRowModel({
				cellSource: params.cellSource,
				layout: params.layout,
			});
			rowModelMemo = {
				cellSourceRevision: params.cellSource.revision,
				layoutMemoKey,
				rowModel,
			};
			return rowModel;
		},
	};
}
